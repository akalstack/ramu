import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SKIP_REASONS, type CookieSameSite, type ImportCookie } from '@ramu/shared/browserImport'
import type { BrowserImportProfile, BrowserImportSkip } from '@ramu/shared/types/browser'
import { CHROMIUM_BROWSERS, linuxOf, type ChromiumBrowserId } from './chromiumBrowsers'

// Readers for the privileged process only. They open a copy of the source database, return parsed cookies to the importer
// and never log or return a value to the renderer. Source paths come from discovery here, never from the renderer.

export interface CookieRead {
  cookies: ImportCookie[]
  skipped: BrowserImportSkip[]
}

const MAX_COOKIES = 20_000

/** Reads a browser's database from a private copy, so a running browser's lock and write-ahead log never block or change it. */
function withCopy<T>(path: string, run: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-import-'))
  try {
    const copy = join(dir, 'cookies.sqlite')
    copyFileSync(path, copy)
    for (const suffix of ['-wal', '-shm']) if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix)
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      return run(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- Firefox ----

/** Profiles named in Firefox's `profiles.ini`. Paths are resolved here, relative to the Firefox folder. */
export function firefoxProfiles(
  firefoxDir: string,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): (BrowserImportProfile & { dir: string })[] {
  let text: string
  try {
    text = read(join(firefoxDir, 'profiles.ini'))
  } catch {
    return []
  }
  const profiles: (BrowserImportProfile & { dir: string })[] = []
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    if (!/^\s*\[Profile\d+\]/m.test(block)) continue
    const field = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(block)?.[1]?.trim()
    const path = field('Path')
    const name = field('Name')
    if (!path || !name || path.includes('..')) continue
    const dir = field('IsRelative') === '0' ? path : join(firefoxDir, path)
    profiles.push({ id: path, name, dir })
  }
  return profiles
}

const FIREFOX_SAMESITE: Record<number, CookieSameSite> = { 1: 'lax', 2: 'strict' }

export function readFirefoxCookies(profileDir: string): CookieRead {
  const database = join(profileDir, 'cookies.sqlite')
  if (!existsSync(database)) throw new Error('This Firefox profile has no saved cookies.')
  return withCopy(database, (db) => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(moz_cookies)').all() as { name: string }[]).map((c) => c.name),
    )
    if (!columns.has('host')) throw new Error('This Firefox cookie file is in a format Ramu does not support.')
    const rows = db
      .prepare(
        `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies LIMIT ${MAX_COOKIES}`,
      )
      .all() as Record<string, unknown>[]
    const cookies: ImportCookie[] = []
    for (const row of rows) {
      // Firefox stores milliseconds in newer releases and seconds in older ones.
      const raw = Number(row.expiry)
      const expires = raw > 0 ? (raw > 1e11 ? Math.floor(raw / 1000) : raw) : undefined
      cookies.push({
        name: String(row.name),
        value: String(row.value),
        host: String(row.host),
        path: String(row.path),
        secure: Number(row.isSecure) === 1,
        httpOnly: Number(row.isHttpOnly) === 1,
        // Firefox stores 0 for "no attribute". Keep that as no restriction on a secure cookie; Chromium refuses it otherwise.
        sameSite:
          FIREFOX_SAMESITE[Number(row.sameSite)] ?? (Number(row.isSecure) === 1 ? 'no_restriction' : 'unspecified'),
        ...(expires !== undefined ? { expires } : {}),
        partitioned: /partitionKey=/.test(String(row.originAttributes ?? '')),
      })
    }
    return { cookies, skipped: [] }
  })
}

// ---- Chromium (Chrome, Edge) ----

/** Profiles listed in the browser's `Local State`, named as the person sees them. */
export function chromiumProfiles(
  userDataDir: string,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): (BrowserImportProfile & { dir: string })[] {
  try {
    const state = JSON.parse(read(join(userDataDir, 'Local State'))) as {
      profile?: { info_cache?: Record<string, { name?: unknown }> }
    }
    return Object.entries(state.profile?.info_cache ?? {})
      .filter(([dir]) => /^(Default|Profile \d+)$/.test(dir))
      .map(([dir, info]) => ({
        id: dir,
        name: typeof info.name === 'string' && info.name ? info.name : dir,
        dir: join(userDataDir, dir),
      }))
  } catch {
    return []
  }
}

/** The key Chromium derives from the "Safe Storage" keychain password on macOS. */
export const chromiumKey = (password: string): Buffer => pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')

/** Linux Chromium derives its keys with one iteration. `v10` uses the fixed password "peanuts"; `v11` uses the keyring secret. */
export const chromiumLinuxKey = (password: string): Buffer => pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1')

/** Keys by Chromium's value prefix. macOS only has `v10`. */
export type ChromiumKeys = Partial<Record<'v10' | 'v11', Buffer>>

/** Returns the plain value, or null when the value uses a scheme or key Ramu does not have. */
export function decryptChromiumValue(
  encrypted: Buffer,
  keys: Buffer | ChromiumKeys,
  stripDomainHash: boolean,
): string | null {
  if (encrypted.length < 4) return null
  const version = encrypted.toString('latin1', 0, 3)
  if (version !== 'v10' && version !== 'v11') return null
  const key = Buffer.isBuffer(keys) ? (version === 'v10' ? keys : undefined) : keys[version]
  if (!key) return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
    // From database version 24 the plaintext starts with a SHA-256 of the cookie's host.
    if (stripDomainHash) plain = plain.subarray(32)
    return plain.toString('utf8')
  } catch {
    return null
  }
}

const CHROMIUM_SAMESITE: Record<number, CookieSameSite> = { 0: 'no_restriction', 1: 'lax', 2: 'strict' }
/** Microseconds from 1601-01-01 to 1970-01-01. */
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000

export function readChromiumCookies(profileDir: string, key: Buffer | ChromiumKeys): CookieRead {
  const database = [join(profileDir, 'Network', 'Cookies'), join(profileDir, 'Cookies')].find((path) =>
    existsSync(path),
  )
  if (!database) throw new Error('This browser profile has no saved cookies.')
  return withCopy(database, (db) => {
    const version = Number(
      (db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: unknown } | undefined)?.value ?? 0,
    )
    const columns = new Set((db.prepare('PRAGMA table_info(cookies)').all() as { name: string }[]).map((c) => c.name))
    const partitioned = columns.has('top_frame_site_key') ? 'top_frame_site_key' : "'' AS top_frame_site_key"
    // Chromium's microsecond expiry times are larger than a safe JavaScript integer, so integers are read as BigInt.
    const statement = db.prepare(
      `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, has_expires, ${partitioned}
         FROM cookies LIMIT ${MAX_COOKIES}`,
    )
    statement.setReadBigInts(true)
    const rows = statement.all() as Record<string, unknown>[]
    const cookies: ImportCookie[] = []
    let undecryptable = 0
    for (const row of rows) {
      const encrypted = row.encrypted_value instanceof Uint8Array ? Buffer.from(row.encrypted_value) : Buffer.alloc(0)
      const value = encrypted.length ? decryptChromiumValue(encrypted, key, version >= 24) : String(row.value ?? '')
      if (value === null) {
        undecryptable++
        continue
      }
      const expiresUs = Number(row.expires_utc)
      const hasExpiry = Number(row.has_expires) === 1 && expiresUs > 0
      cookies.push({
        name: String(row.name),
        value,
        host: String(row.host_key),
        path: String(row.path),
        secure: Number(row.is_secure) === 1,
        httpOnly: Number(row.is_httponly) === 1,
        sameSite: CHROMIUM_SAMESITE[Number(row.samesite)] ?? 'unspecified',
        ...(hasExpiry ? { expires: Math.floor((expiresUs - CHROME_EPOCH_OFFSET_US) / 1_000_000) } : {}),
        partitioned: String(row.top_frame_site_key ?? '') !== '',
      })
    }
    return { cookies, skipped: undecryptable ? [{ reason: SKIP_REASONS.undecryptable, count: undecryptable }] : [] }
  })
}

type Exec = (file: string, args: string[]) => Promise<string>
const run: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 60_000, encoding: 'utf8' }, (error, stdout) =>
      error ? reject(new Error('The keychain did not allow access.')) : resolve(stdout.replace(/\n$/, '')),
    ),
  )

/** macOS asks the person to allow keychain access for this one read. A refusal is reported, never bypassed. */
export function keychainPassword(browser: ChromiumBrowserId, exec: Exec = run): Promise<string> {
  const { service, account } = CHROMIUM_BROWSERS[browser].mac.keychain
  return exec('/usr/bin/security', ['find-generic-password', '-w', '-s', service, '-a', account])
}

/**
 * Linux keeps Chromium's "Safe Storage" secret in the desktop keyring (libsecret). A missing tool or refusal returns null:
 * cookies using that secret are then reported as unreadable instead of the import failing.
 */
export async function linuxKeyringPassword(browser: ChromiumBrowserId, exec: Exec = run): Promise<string | null> {
  for (const application of linuxOf(browser)?.keyring ?? []) {
    try {
      const secret = await exec('secret-tool', ['lookup', 'application', application])
      if (secret) return secret
    } catch {
      // Try the next application name, then fall back to v10 cookies only.
    }
  }
  return null
}
