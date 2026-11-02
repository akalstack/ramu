import { createCipheriv } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserImporter, sourceRoot } from '../src/browser/browserImport'
import { chromiumKey } from '../src/browser/browserImportReaders'
import { BrowserProfiles } from '../src/browser/browserProfiles'

let home: string
let profilesPath: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ramu-import-home-'))
  profilesPath = join(home, 'profiles.json')
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function firefoxFixture() {
  const root = sourceRoot('firefox', home)
  mkdirSync(join(root, 'Profiles/abc.default'), { recursive: true })
  writeFileSync(join(root, 'profiles.ini'), '[Profile0]\nName=default\nIsRelative=1\nPath=Profiles/abc.default\n')
  const db = new DatabaseSync(join(root, 'Profiles/abc.default/cookies.sqlite'))
  db.exec(
    `CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)`,
  )
  const insert = db.prepare('INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?,?)')
  insert.run('.example.com', 'sid', 'one', '/', 4_000_000_000, 1, 1, 1, '')
  insert.run('app.example.com', 'host', 'two', '/', 0, 0, 0, 0, '')
  insert.run('.other.org', 'o', 'three', '/', 4_000_000_000, 1, 0, 1, '')
  db.close()
}

function make(overrides: Partial<ConstructorParameters<typeof BrowserImporter>[0]> = {}) {
  const profiles = new BrowserProfiles(profilesPath)
  const set = vi.fn(async (_profile: string, _cookie: unknown) => {})
  const flush = vi.fn(async () => {})
  const clear = vi.fn(async () => {})
  const importer = new BrowserImporter({ profiles, home, setCookie: set, flush, clearData: clear, ...overrides })
  return { importer, profiles, set, flush, clear }
}

describe('browser import', () => {
  it('lists source profiles and the websites in one, with counts only', async () => {
    firefoxFixture()
    const { importer } = make()
    expect(importer.profiles('firefox')).toEqual([{ id: 'Profiles/abc.default', name: 'default' }])
    const { token, domains } = await importer.inspect('firefox', 'Profiles/abc.default')
    expect(domains).toEqual([
      { domain: 'example.com', cookies: 2 },
      { domain: 'other.org', cookies: 1 },
    ])
    expect(JSON.stringify(domains)).not.toContain('one')
    expect(token).toMatch(/[0-9a-f-]{36}/)
    await expect(importer.inspect('firefox', '../../etc')).rejects.toThrow(/no longer available/)
  })

  it('copies only the chosen sites into a hidden profile and reports exact counts', async () => {
    firefoxFixture()
    const { importer, profiles, set, flush } = make()
    const { token } = await importer.inspect('firefox', 'Profiles/abc.default')
    const staged = await importer.run(token, ['example.com'], 'From Firefox')
    expect(staged.result).toEqual({ imported: 2, skipped: [], failed: 0 })
    expect(set).toHaveBeenCalledTimes(2)
    expect(set.mock.calls.every(([profile]) => profile === staged.profileId)).toBe(true)
    expect(set.mock.calls.map(([, cookie]) => (cookie as { name: string }).name).sort()).toEqual(['host', 'sid'])
    expect(flush).toHaveBeenCalledWith(staged.profileId)
    expect(profiles.catalog().profiles.map((profile) => profile.id)).not.toContain(staged.profileId)
    importer.keep(staged.profileId)
    expect(profiles.catalog().profiles.find((profile) => profile.id === staged.profileId)?.importedAt).toBeGreaterThan(
      0,
    )
    await expect(importer.run(token, ['example.com'], 'Again')).rejects.toThrow(/Choose the browser profile again/)
  })

  it('counts a cookie the browser refused and still imports the rest', async () => {
    firefoxFixture()
    const set = vi.fn(async (_profile: string, cookie: { name: string }) => {
      if (cookie.name === 'host') throw new Error('refused')
    })
    const { importer } = make({ setCookie: set })
    const { token } = await importer.inspect('firefox', 'Profiles/abc.default')
    const staged = await importer.run(token, ['example.com'], 'Partial')
    expect(staged.result).toMatchObject({ imported: 1, failed: 1 })
  })

  it('discards the staged profile and its data when nothing could be saved or the flush fails', async () => {
    firefoxFixture()
    const failing = make({
      setCookie: vi.fn(async () => {
        throw new Error('refused')
      }),
    })
    let { token } = await failing.importer.inspect('firefox', 'Profiles/abc.default')
    await expect(failing.importer.run(token, ['example.com'], 'Nope')).rejects.toThrow(/No cookie could be saved/)
    expect(failing.clear).toHaveBeenCalledTimes(1)
    expect(failing.profiles.stagedIds()).toEqual([])

    const unflushed = make({
      flush: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    ;({ token } = await unflushed.importer.inspect('firefox', 'Profiles/abc.default'))
    await expect(unflushed.importer.run(token, ['example.com'], 'Nope')).rejects.toThrow(/disk full/)
    expect(unflushed.clear).toHaveBeenCalledTimes(1)
    expect(unflushed.profiles.stagedIds()).toEqual([])
  })

  it('discards a kept-later import on request and cleans up leftovers at startup', async () => {
    firefoxFixture()
    const { importer, profiles, clear } = make()
    const { token } = await importer.inspect('firefox', 'Profiles/abc.default')
    const staged = await importer.run(token, ['other.org'], 'Later')
    await importer.discard(staged.profileId)
    expect(clear).toHaveBeenCalledWith(staged.profileId)
    expect(profiles.stagedIds()).toEqual([])
    const leftover = profiles.stage('Leftover')
    clear.mockClear()
    await importer.cleanup()
    expect(clear).toHaveBeenCalledWith(leftover.id)
    expect(profiles.stagedIds()).toEqual([])
  })

  it('needs a choice, expires old reads, and limits how many are waiting', async () => {
    firefoxFixture()
    let time = 1_000
    const { importer } = make({ now: () => time })
    const first = await importer.inspect('firefox', 'Profiles/abc.default')
    await expect(importer.run(first.token, [], 'x')).rejects.toThrow(/at least one website/)
    await expect(importer.run(first.token, ['nothing.test'], 'x')).rejects.toThrow(/None of the chosen websites/)
    await importer.inspect('firefox', 'Profiles/abc.default')
    await expect(importer.inspect('firefox', 'Profiles/abc.default')).rejects.toThrow(/Finish or cancel/)
    importer.cancel(first.token)
    time += 11 * 60_000
    await expect(importer.run(first.token, ['example.com'], 'x')).rejects.toThrow(/Choose the browser profile again/)
    await expect(importer.inspect('firefox', 'Profiles/abc.default')).resolves.toBeTruthy()
  })

  it('reads a Chromium profile after the keychain allows it, and reports a refusal', async () => {
    const root = sourceRoot('chrome', home, 'darwin')
    mkdirSync(join(root, 'Default'), { recursive: true })
    writeFileSync(
      join(root, 'Local State'),
      JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' } } } }),
    )
    const key = chromiumKey('pw')
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const encrypted = Buffer.concat([
      Buffer.from('v10'),
      cipher.update(Buffer.concat([Buffer.alloc(32), Buffer.from('v')])),
      cipher.final(),
    ])
    const db = new DatabaseSync(join(root, 'Default', 'Cookies'))
    db.exec(`CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version','24');
      CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, has_expires INTEGER)`)
    db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      '.example.com',
      'sid',
      '',
      encrypted,
      '/',
      0,
      1,
      1,
      1,
      0,
    )
    db.close()
    const ok = make({ platform: 'darwin', keychainPassword: async () => 'pw' })
    const { domains } = await ok.importer.inspect('chrome', 'Default')
    expect(domains).toEqual([{ domain: 'example.com', cookies: 1 }])
    const refused = make({
      platform: 'darwin',
      keychainPassword: async () => {
        throw new Error('The keychain did not allow access.')
      },
    })
    await expect(refused.importer.inspect('chrome', 'Default')).rejects.toThrow(/did not allow access/)
  })
})

it('finds Firefox profiles under the roaming folder on Windows', () => {
  const env = { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' } as NodeJS.ProcessEnv
  expect(sourceRoot('firefox', 'C:\\Users\\a', 'win32', () => false, env).replace(/\\/g, '/')).toMatch(
    /AppData\/Roaming\/Mozilla\/Firefox$/,
  )
  expect(sourceRoot('firefox', '/home/a', 'win32', () => false, {} as NodeJS.ProcessEnv)).toMatch(
    /AppData\/Roaming\/Mozilla\/Firefox$/,
  )
})
