import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  importDomains,
  mergeSkips,
  selectCookies,
  toElectronCookie,
  type ElectronCookie,
  type ImportCookie,
} from '@ramu/shared/browserImport'
import type {
  BrowserImportDomain,
  BrowserImportProfile,
  BrowserImportSkip,
  BrowserImportStaged,
} from '@ramu/shared/types/browser'
import type { BrowserProfiles } from './browserProfiles'
import {
  chromiumKey,
  chromiumLinuxKey,
  linuxKeyringPassword,
  chromiumProfiles,
  firefoxProfiles,
  keychainPassword,
  readChromiumCookies,
  readFirefoxCookies,
  type CookieRead,
} from './browserImportReaders'

export type ImportSourceId = 'chrome' | 'edge' | 'firefox'

/**
 * Where each supported source keeps its profiles on macOS, Linux and (Firefox only) Windows. Safari and Windows Chromium
 * stay unsupported: their cookies are protected in ways Ramu does not read.
 */
export function sourceRoot(
  source: ImportSourceId,
  home: string,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Firefox keeps plain SQLite cookies under the roaming profile on Windows; Chromium's are app-bound encrypted there.
  if (platform === 'win32' && source === 'firefox')
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox')
  if (platform === 'linux') {
    const first = (candidates: string[]) => candidates.find((path) => exists(path)) ?? candidates[0]!
    return source === 'chrome'
      ? first([join(home, '.config/google-chrome'), join(home, '.config/chromium')])
      : source === 'edge'
        ? join(home, '.config/microsoft-edge')
        : first([join(home, '.mozilla/firefox'), join(home, 'snap/firefox/common/.mozilla/firefox')])
  }
  const support = join(home, 'Library/Application Support')
  return source === 'chrome'
    ? join(support, 'Google/Chrome')
    : source === 'edge'
      ? join(support, 'Microsoft Edge')
      : join(support, 'Firefox')
}

export interface ImporterDeps {
  profiles: BrowserProfiles
  home: string
  /** Sets one cookie in a profile's website data. Rejects when the browser refuses it. */
  setCookie(profileId: string, cookie: ElectronCookie): Promise<void>
  /** Writes pending cookies to disk. A failure here means the import did not persist. */
  flush(profileId: string): Promise<void>
  /** Removes all website data of a profile. */
  clearData(profileId: string): Promise<void>
  keychainPassword?: typeof keychainPassword
  keyringPassword?: typeof linuxKeyringPassword
  platform?: NodeJS.Platform
  now?: () => number
}

interface Pending {
  read: CookieRead
  expires: number
}

const PENDING_MS = 10 * 60_000
const MAX_PENDING = 2

/**
 * Copies website sign-ins once from another browser into a new profile. Cookie values stay in this process: the renderer
 * receives site names with counts, then counts and reasons. Nothing is written to the source browser.
 */
export class BrowserImporter {
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly deps: ImporterDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)()
  }

  /** Browser profiles the person can choose from. Reads names only. */
  profiles(source: ImportSourceId): BrowserImportProfile[] {
    const root = sourceRoot(source, this.deps.home, this.deps.platform)
    const list = source === 'firefox' ? firefoxProfiles(root) : chromiumProfiles(root)
    return list.map(({ id, name }) => ({ id, name }))
  }

  /**
   * Reads a profile's cookies and lists the websites in them. Chromium browsers ask macOS for keychain access (or read the Linux keyring) here; a refusal
   * is reported, not bypassed. The parsed cookies wait in memory, under a token, for `run` or `cancel`.
   */
  async inspect(source: ImportSourceId, profileId: string): Promise<{ token: string; domains: BrowserImportDomain[] }> {
    const root = sourceRoot(source, this.deps.home, this.deps.platform)
    const found = (source === 'firefox' ? firefoxProfiles(root) : chromiumProfiles(root)).find(
      (entry) => entry.id === profileId,
    )
    if (!found) throw new Error('That browser profile is no longer available.')
    this.expire()
    if (this.pending.size >= MAX_PENDING) throw new Error('Finish or cancel the import you started first.')
    let read: CookieRead
    if (source === 'firefox') read = readFirefoxCookies(found.dir)
    else if ((this.deps.platform ?? process.platform) === 'linux') {
      const secret = await (this.deps.keyringPassword ?? linuxKeyringPassword)(source)
      read = readChromiumCookies(found.dir, {
        v10: chromiumLinuxKey('peanuts'),
        ...(secret ? { v11: chromiumLinuxKey(secret) } : {}),
      })
    } else {
      const password = await (this.deps.keychainPassword ?? keychainPassword)(source)
      read = readChromiumCookies(found.dir, chromiumKey(password))
    }
    const token = randomUUID()
    this.pending.set(token, { read, expires: this.now() + PENDING_MS })
    return { token, domains: importDomains(read.cookies) }
  }

  cancel(token: string): void {
    this.pending.delete(token)
  }

  /**
   * Stages a new profile and copies the chosen websites' cookies into it. On a fatal failure the staged profile and its
   * data are removed. On success it stays hidden until Keep.
   */
  async run(token: string, domains: string[], name: string): Promise<BrowserImportStaged> {
    this.expire()
    const pending = this.pending.get(token)
    if (!pending) throw new Error('Choose the browser profile again.')
    if (!domains.length) throw new Error('Choose at least one website.')
    const picked = selectCookies(pending.read.cookies as ImportCookie[], domains, this.now())
    if (!picked.cookies.length) throw new Error('None of the chosen websites has a cookie that can be copied.')
    const staged = this.deps.profiles.stage(name)
    let imported = 0
    let failed = 0
    try {
      for (const cookie of picked.cookies) {
        try {
          await this.deps.setCookie(staged.id, toElectronCookie(cookie))
          imported++
        } catch {
          failed++
        }
      }
      if (!imported) throw new Error('No cookie could be saved in the new profile.')
      // Only report success once the cookies are on disk.
      await this.deps.flush(staged.id)
    } catch (error) {
      await this.removeStaged(staged.id)
      this.pending.delete(token)
      throw error
    }
    this.pending.delete(token)
    const skipped: BrowserImportSkip[] = mergeSkips(pending.read.skipped, picked.skipped)
    return { profileId: staged.id, name: staged.name, result: { imported, skipped, failed } }
  }

  /** Makes the staged profile available to agents and the person. */
  keep(profileId: string) {
    return this.deps.profiles.keep(profileId)
  }

  /** Removes an import that was not kept, including every cookie it wrote. */
  async discard(profileId: string): Promise<void> {
    await this.removeStaged(profileId)
  }

  /** Called at startup: an import that was never kept is not left behind. */
  async cleanup(): Promise<void> {
    for (const id of this.deps.profiles.stagedIds()) await this.removeStaged(id).catch(() => {})
  }

  private async removeStaged(profileId: string): Promise<void> {
    // Data first: a record without data is harmless, data without a record could never be removed.
    await this.deps.clearData(profileId)
    this.deps.profiles.discard(profileId)
  }

  private expire() {
    for (const [token, entry] of this.pending) if (entry.expires <= this.now()) this.pending.delete(token)
  }
}
