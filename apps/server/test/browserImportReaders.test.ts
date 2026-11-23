import { createCipheriv } from 'node:crypto'
import { BROWSER_DATA_BLOCKED } from '@ramu/shared/types/browser'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chromiumKey,
  chromiumLinuxKey,
  linuxKeyringPassword,
  chromiumProfiles,
  decryptChromiumValue,
  firefoxProfiles,
  keychainPassword,
  readChromiumCookies,
  readFirefoxCookies,
} from '../src/browser/browserImportReaders'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-readers-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const encrypt = (value: string, key: Buffer, prefixHash: boolean) => {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  const plain = Buffer.concat([prefixHash ? Buffer.alloc(32, 7) : Buffer.alloc(0), Buffer.from(value)])
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()])
}

describe('Firefox', () => {
  it('lists named profiles from profiles.ini and ignores paths that climb out', () => {
    const ini = [
      '[Profile0]',
      'Name=default-release',
      'IsRelative=1',
      'Path=Profiles/abc.default-release',
      '',
      '[Profile1]',
      'Name=sneaky',
      'IsRelative=1',
      'Path=../../elsewhere',
      '',
      '[General]',
      'StartWithLastProfile=1',
    ].join('\n')
    const found = firefoxProfiles('/ff', () => ini)
    expect(found).toEqual([
      { id: 'Profiles/abc.default-release', name: 'default-release', dir: '/ff/Profiles/abc.default-release' },
    ])
    expect(
      firefoxProfiles('/ff', () => {
        throw new Error('missing')
      }),
    ).toEqual([])
  })

  it('reads cookies with their attributes and flags partitioned ones', () => {
    mkdirSync(join(dir, 'p'))
    const db = new DatabaseSync(join(dir, 'p', 'cookies.sqlite'))
    db.exec(
      `CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)`,
    )
    const insert = db.prepare('INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?,?)')
    insert.run('.example.com', 'sid', 'abc', '/', 4_000_000_000_000, 1, 1, 1, '')
    insert.run('app.example.com', 'host', 'x', '/a', 0, 0, 0, 2, '')
    insert.run('.tracker.net', 'p', 'y', '/', 4_000_000_000, 1, 0, 0, '^partitionKey=%28https%2Cexample.com%29')
    db.close()
    const { cookies } = readFirefoxCookies(join(dir, 'p'))
    expect(cookies).toHaveLength(3)
    expect(cookies[0]).toMatchObject({
      host: '.example.com',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expires: 4_000_000_000,
      partitioned: false,
    })
    expect(cookies[1]).toMatchObject({ host: 'app.example.com', sameSite: 'strict', path: '/a' })
    expect(cookies[1]!.expires).toBeUndefined()
    expect(cookies[2]!.partitioned).toBe(true)
    // A secure cookie with no attribute keeps no restriction; an insecure one cannot, so it is left unspecified.
    expect(cookies[2]!.sameSite).toBe('no_restriction')
  })

  it('leaves SameSite unspecified on an insecure cookie with no attribute', () => {
    mkdirSync(join(dir, 'q'))
    const db = new DatabaseSync(join(dir, 'q', 'cookies.sqlite'))
    db.exec(
      `CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)`,
    )
    db.prepare('INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?,?)').run('plain.test', 'a', 'b', '/', 0, 0, 0, 0, '')
    db.close()
    expect(readFirefoxCookies(join(dir, 'q')).cookies[0]!.sameSite).toBe('unspecified')
  })

  it('reports a profile without a cookie file', () => {
    expect(() => readFirefoxCookies(dir)).toThrow(/no saved cookies/)
  })
})

describe('Chromium', () => {
  const key = chromiumKey('keychain-secret')

  it('lists profiles by the names people gave them', () => {
    const state = JSON.stringify({
      profile: { info_cache: { Default: { name: 'Work' }, 'Profile 2': {}, 'Guest Profile': { name: 'g' } } },
    })
    expect(chromiumProfiles('/chrome', () => state)).toEqual([
      { id: 'Default', name: 'Work', dir: '/chrome/Default' },
      { id: 'Profile 2', name: 'Profile 2', dir: '/chrome/Profile 2' },
    ])
    expect(chromiumProfiles('/chrome', () => 'not json')).toEqual([])
    // A missing browser has no profiles; one the system will not let Ramu read says so, so it can offer the setting.
    const refuse = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    expect(chromiumProfiles('/chrome', refuse('ENOENT'))).toEqual([])
    expect(() => chromiumProfiles('/chrome', refuse('EPERM'))).toThrow(BROWSER_DATA_BLOCKED)
  })

  it('decrypts v10 values, with and without the domain hash prefix, and refuses other schemes', () => {
    expect(decryptChromiumValue(encrypt('hello', key, false), key, false)).toBe('hello')
    expect(decryptChromiumValue(encrypt('hello', key, true), key, true)).toBe('hello')
    expect(decryptChromiumValue(Buffer.from('v11xxxxxxxxxxxxxxxx'), key, false)).toBeNull()
    expect(decryptChromiumValue(encrypt('hello', key, false), chromiumKey('wrong'), false)).not.toBe('hello')
  })

  it('decrypts Linux v10 (peanuts) and v11 (keyring) values and skips v11 without a keyring secret', () => {
    const v10 = chromiumLinuxKey('peanuts')
    const v11 = chromiumLinuxKey('keyring-secret')
    const withPrefix = (value: Buffer, prefix: string) => Buffer.concat([Buffer.from(prefix), value.subarray(3)])
    const a = withPrefix(encrypt('one', v10, false), 'v10')
    const b = withPrefix(encrypt('two', v11, false), 'v11')
    expect(decryptChromiumValue(a, { v10, v11 }, false)).toBe('one')
    expect(decryptChromiumValue(b, { v10, v11 }, false)).toBe('two')
    expect(decryptChromiumValue(b, { v10 }, false)).toBeNull()
  })

  it('reads the Linux keyring secret and falls back to null when unavailable', async () => {
    const seen: string[][] = []
    expect(
      await linuxKeyringPassword('chrome', async (file, args) => {
        seen.push([file, ...args])
        if (args[2] === 'chrome') throw new Error('none')
        return 'secret'
      }),
    ).toBe('secret')
    expect(seen.map((call) => call[3])).toEqual(['chrome', 'chromium'])
    expect(
      await linuxKeyringPassword('edge', async () => {
        throw new Error('no tool')
      }),
    ).toBeNull()
    const asked: string[] = []
    await linuxKeyringPassword('brave', async (_file, args) => (asked.push(args[2]!), 'b'))
    await linuxKeyringPassword('vivaldi', async (_file, args) => (asked.push(args[2]!), 'v'))
    expect(asked).toEqual(['brave', 'vivaldi'])
    // A browser with no Linux build has nothing to ask the keyring for.
    expect(await linuxKeyringPassword('arc', async () => 'never')).toBeNull()
  })

  it('reads encrypted and plain cookies, converts the expiry, and counts what it could not decrypt', () => {
    mkdirSync(join(dir, 'Default', 'Network'), { recursive: true })
    const db = new DatabaseSync(join(dir, 'Default', 'Network', 'Cookies'))
    db.exec(`CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24');
      CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, has_expires INTEGER, top_frame_site_key TEXT)`)
    const insert = db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    const expiresUs = 11_644_473_600_000_000 + 4_000_000_000 * 1_000_000
    insert.run('.example.com', 'sid', '', encrypt('top-secret', key, true), '/', expiresUs, 1, 1, 1, 1, '')
    insert.run('plain.test', 'p', 'visible', new Uint8Array(0), '/', 0, 0, 0, -1, 0, '')
    insert.run('.bad.test', 'b', '', Buffer.from('v11abcdefghijklmnop'), '/', 0, 0, 0, -1, 0, '')
    insert.run('.tracker.net', 't', '', encrypt('tp', key, true), '/', 0, 1, 0, 0, 0, 'https://example.com')
    db.close()
    const { cookies, skipped } = readChromiumCookies(join(dir, 'Default'), key)
    expect(cookies.map((cookie) => cookie.name)).toEqual(['sid', 'p', 't'])
    expect(cookies[0]).toMatchObject({ value: 'top-secret', expires: 4_000_000_000, sameSite: 'lax', httpOnly: true })
    expect(cookies[1]).toMatchObject({ value: 'visible', sameSite: 'unspecified' })
    expect(cookies[2]!.partitioned).toBe(true)
    expect(skipped).toEqual([{ reason: expect.stringMatching(/could not be read/), count: 1 }])
  })

  it('reads a copy, so the source database is left untouched', () => {
    mkdirSync(join(dir, 'Default'), { recursive: true })
    const path = join(dir, 'Default', 'Cookies')
    const db = new DatabaseSync(path)
    db.exec(
      `CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, has_expires INTEGER)`,
    )
    db.close()
    writeFileSync(path + '-journal', '')
    expect(readChromiumCookies(join(dir, 'Default'), key).cookies).toEqual([])
  })
})

describe('keychain', () => {
  it('asks for the right Safe Storage entry per browser and reports a refusal plainly', async () => {
    const calls: string[][] = []
    const exec = async (file: string, args: string[]) => {
      calls.push([file, ...args])
      return 'pw'
    }
    expect(await keychainPassword('chrome', exec)).toBe('pw')
    await keychainPassword('edge', exec)
    expect(calls[0]).toEqual([
      '/usr/bin/security',
      'find-generic-password',
      '-w',
      '-s',
      'Chrome Safe Storage',
      '-a',
      'Chrome',
    ])
    expect(calls[1]).toContain('Microsoft Edge Safe Storage')
    await keychainPassword('brave', exec)
    await keychainPassword('arc', exec)
    expect(calls.slice(2).map((call) => call.slice(4))).toEqual([
      ['Brave Safe Storage', '-a', 'Brave'],
      ['Arc Safe Storage', '-a', 'Arc'],
    ])
    await expect(
      keychainPassword('chrome', async () => {
        throw new Error('The keychain did not allow access.')
      }),
    ).rejects.toThrow(/did not allow/)
  })
})
