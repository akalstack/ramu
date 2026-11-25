import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AppUpdateService, assetChecksum, parseAppRelease, pickAppRelease } from '../src/background/appUpdates'
import { runtimeBuild } from '../src/build'
import { writeFileSync } from 'node:fs'

const dirs: string[] = [],
  services: AppUpdateService[] = []
afterEach(() => {
  services.forEach((service) => service.close())
  services.length = 0
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const fixture = (body: string) => ({
  tag_name: 'v0.2.0',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/akalstack/ramu/releases/tag/v0.2.0',
  published_at: '2026-10-12T00:00:00Z',
  assets: [
    {
      name: `${process.platform}-${process.arch}-Ramu.zip`,
      size: body.length,
      browser_download_url: 'https://github.com/akalstack/ramu/releases/download/v0.2.0/Ramu.zip',
    },
    {
      name: `SHA256SUMS-${process.platform}-${process.arch}.txt`,
      size: 80,
      browser_download_url: 'https://github.com/akalstack/ramu/releases/download/v0.2.0/SHA256SUMS.txt',
    },
  ],
})
const make = (preferences = { appUpdateChecks: false, appAutoUpdate: false }, options: { installs?: boolean } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu updates '))
  dirs.push(dir)
  const service = new AppUpdateService(dir, '0.1.0', () => preferences, vi.fn(), options)
  services.push(service)
  return { service, dir }
}
it('selects published matching-platform assets and requires an exact checksum', () => {
  expect(parseAppRelease(fixture('zip'))?.version).toBe('0.2.0')
  expect(parseAppRelease({ ...fixture('zip'), draft: true })).toBeNull()
  expect(parseAppRelease(fixture('zip'), 'win32')).toBeNull()
  const digest = 'a'.repeat(64)
  expect(assetChecksum(`${digest}  Ramu.zip\n`, 'Ramu.zip')).toBe(digest)
  expect(() => assetChecksum(`${digest}  other.zip`, 'Ramu.zip')).toThrow()
  expect(() => assetChecksum(`${digest}  Ramu.zip\n${digest}  Ramu.zip`, 'Ramu.zip')).toThrow()
})
it('follows the release channel of the installed version, moving only toward stable', () => {
  const tagged = (tag: string, prerelease = tag.includes('-')) => ({
    ...fixture('zip'),
    tag_name: tag,
    prerelease,
    html_url: `https://github.com/akalstack/ramu/releases/tag/${tag}`,
  })
  const releases = [tagged('v0.3.0-alpha.1'), tagged('v0.2.0'), tagged('v0.2.0-beta.2'), tagged('v0.1.0-alpha.3')]
  expect(pickAppRelease(releases, '0.1.0-alpha.2')?.version).toBe('0.3.0-alpha.1')
  expect(pickAppRelease(releases, '0.2.0-beta.1')?.version).toBe('0.2.0')
  expect(pickAppRelease(releases, '0.1.0')?.version).toBe('0.2.0')
  expect(pickAppRelease([tagged('v0.2.0-alpha.1'), tagged('v0.1.0-beta.3')], '0.1.0-beta.2')?.version).toBe(
    '0.1.0-beta.3',
  )
  expect(pickAppRelease([{ ...tagged('v0.4.0'), draft: true }, { broken: true }], '0.1.0')).toBeNull()
})
it('stages a checksum-verified GitHub download and restores it after a daemon restart', async () => {
  const body = 'zip-content',
    release = fixture(body),
    digest = createHash('sha256').update(body).digest('hex')
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          url.includes('api.github')
            ? JSON.stringify([release])
            : url.includes('SHA256SUMS')
              ? `${digest}  ${release.assets[0]!.name}`
              : body,
        ),
    ),
  )
  const { service, dir } = make()
  expect((await service.check()).phase).toBe('available')
  expect((await service.download()).phase).toBe('ready')
  expect(readFileSync(join(service.directory, release.assets[0]!.name), 'utf8')).toBe(body)
  service.close()
  const restored = new AppUpdateService(dir, '0.1.0', () => ({ appUpdateChecks: false, appAutoUpdate: false }), vi.fn())
  services.push(restored)
  // The staged file is verified in the background, so a restart never waits on hashing it.
  await vi.waitFor(() => expect(restored.status().phase).toBe('ready'))
})
it('rejects corrupt downloads without staging an installable update', async () => {
  const release = fixture('bad')
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          url.includes('api.github')
            ? JSON.stringify([release])
            : url.includes('SHA256SUMS')
              ? `${'a'.repeat(64)}  ${release.assets[0]!.name}`
              : 'bad',
        ),
    ),
  )
  const { service } = make()
  await service.check()
  expect((await service.download()).phase).toBe('error')
  expect(service.status().error).toContain('checksum')
})
it('auto-downloads in the service without asking Electron to restart anything', async () => {
  vi.useFakeTimers()
  const { service } = make({ appUpdateChecks: false, appAutoUpdate: true }, { installs: true })
  vi.spyOn(service, 'check').mockResolvedValue({ ...service.status(), phase: 'available' })
  const download = vi.spyOn(service, 'download').mockResolvedValue({ ...service.status(), phase: 'ready' })
  await vi.advanceTimersByTimeAsync(45_000)
  expect(download).toHaveBeenCalledOnce()
  service.close()
  await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
  expect(download).toHaveBeenCalledOnce()
})
it('does not download by itself when no app on this host can install the update', async () => {
  vi.useFakeTimers()
  const { service } = make({ appUpdateChecks: false, appAutoUpdate: true })
  vi.spyOn(service, 'check').mockResolvedValue({ ...service.status(), phase: 'available' })
  const download = vi.spyOn(service, 'download').mockResolvedValue({ ...service.status(), phase: 'ready' })
  await vi.advanceTimersByTimeAsync(45_000)
  expect(download).not.toHaveBeenCalled()
  service.close()
})
it('service identity changes with shared code, independent of filesystem timestamps', () => {
  const { dir } = make()
  const daemon = join(dir, 'daemon.js')
  writeFileSync(daemon, 'entry')
  writeFileSync(join(dir, 'shared.js'), 'v1')
  const original = runtimeBuild(daemon)
  expect(runtimeBuild(daemon)).toBe(original)
  writeFileSync(join(dir, 'shared.js'), 'v2')
  expect(runtimeBuild(daemon)).not.toBe(original)
})

it('aborts an update check without an error and can check again', async () => {
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        }),
    )
    .mockResolvedValue(new Response(JSON.stringify([fixture('zip')])))
  vi.stubGlobal('fetch', fetcher)
  const { service } = make()
  const checking = service.check()
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  await service.cancel()
  expect((await checking).phase).toBe('idle')
  expect(service.status().error).toBeNull()
  expect((await service.check()).phase).toBe('available')
})

it('cancels a download without staging partial files and permits another download', async () => {
  const body = 'zip-content',
    release = fixture(body),
    digest = createHash('sha256').update(body).digest('hex')
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify([release])))
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        }),
    )
    .mockResolvedValueOnce(new Response(`${digest}  ${release.assets[0]!.name}\n`))
    .mockResolvedValueOnce(new Response(body))
  vi.stubGlobal('fetch', fetcher)
  const { service } = make()
  await service.check()
  const downloading = service.download()
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  await service.cancel()
  expect(await downloading).toMatchObject({ phase: 'available', error: null, downloadedBytes: 0 })
  expect((await service.download()).phase).toBe('ready')
})
it('names a release out less than a day instead of offering it, until the person installs it now', async () => {
  const release = { ...fixture('zip'), published_at: new Date(Date.now() - 3_600_000).toISOString() }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([release]))),
  )
  const { service } = make()
  const waiting = await service.check()
  expect(waiting).toMatchObject({ phase: 'idle', release: null, waiting: { version: '0.2.0' } })
  expect(Date.parse(waiting.waiting!.settlesAt)).toBeGreaterThan(Date.now() + 22 * 3_600_000)
  expect(await service.skipWait()).toMatchObject({ phase: 'available', release: { version: '0.2.0' }, waiting: null })
  // The choice holds on the next check.
  expect((await service.check()).phase).toBe('available')
})
it('offers a fresh release at once when waiting is off', async () => {
  const release = { ...fixture('zip'), published_at: new Date().toISOString() }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([release]))),
  )
  const dir = mkdtempSync(join(tmpdir(), 'ramu updates '))
  dirs.push(dir)
  const service = new AppUpdateService(
    dir,
    '0.1.0',
    () => ({ appUpdateChecks: false, appAutoUpdate: false, updateWait: false }),
    vi.fn(),
  )
  services.push(service)
  expect((await service.check()).phase).toBe('available')
})
