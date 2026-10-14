import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AppUpdateService, assetChecksum, parseAppRelease } from '../src/appUpdates'
import { runtimeBuild } from '../src/build'
import { APP_AUTO_UPDATE } from '@ramu/shared/updates'
import { writeFileSync } from 'node:fs'

const dirs: string[] = [], services: AppUpdateService[] = []
afterEach(() => { services.forEach((service) => service.close()); services.length = 0; dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })); dirs.length = 0; vi.unstubAllGlobals(); vi.useRealTimers() })
const fixture = (body: string) => ({ tag_name: 'v0.2.0', draft: false, prerelease: false, html_url: 'https://github.com/ahxar/ramu/releases/tag/v0.2.0', published_at: '2026-10-12T00:00:00Z', assets: [{ name: `${process.platform}-${process.arch}-Ramu.zip`, size: body.length, browser_download_url: 'https://github.com/ahxar/ramu/releases/download/v0.2.0/Ramu.zip' }, { name: `SHA256SUMS-${process.platform}-${process.arch}.txt`, size: 80, browser_download_url: 'https://github.com/ahxar/ramu/releases/download/v0.2.0/SHA256SUMS.txt' }] })
const make = (preferences = { appUpdateChecks: false, appAutoUpdate: false }) => { const dir = mkdtempSync(join(tmpdir(), 'ramu updates ')); dirs.push(dir); const service = new AppUpdateService(dir, '0.1.0', () => preferences, vi.fn()); services.push(service); return { service, dir } }
it('selects published matching-platform assets and requires an exact checksum', () => {
  expect(parseAppRelease(fixture('zip'))?.version).toBe('0.2.0')
  expect(parseAppRelease({ ...fixture('zip'), prerelease: true })).toBeNull()
  expect(parseAppRelease(fixture('zip'), 'win32')).toBeNull()
  const digest = 'a'.repeat(64)
  expect(assetChecksum(`${digest}  Ramu.zip\n`, 'Ramu.zip')).toBe(digest)
  expect(() => assetChecksum(`${digest}  other.zip`, 'Ramu.zip')).toThrow()
  expect(() => assetChecksum(`${digest}  Ramu.zip\n${digest}  Ramu.zip`, 'Ramu.zip')).toThrow()
})
it('stages a checksum-verified GitHub download and restores it after a daemon restart', async () => {
  const body = 'zip-content', release = fixture(body), digest = createHash('sha256').update(body).digest('hex')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('api.github') ? JSON.stringify(release) : url.includes('SHA256SUMS') ? `${digest}  ${release.assets[0]!.name}` : body)))
  const { service, dir } = make()
  expect((await service.check()).phase).toBe('available')
  expect((await service.download()).phase).toBe('ready')
  expect(readFileSync(join(service.directory, release.assets[0]!.name), 'utf8')).toBe(body)
  service.close()
  const restored = new AppUpdateService(dir, '0.1.0', () => ({ appUpdateChecks: false, appAutoUpdate: false }), vi.fn()); services.push(restored)
  expect(restored.status().phase).toBe('ready')
})
it('rejects corrupt downloads without staging an installable update', async () => {
  const release = fixture('bad')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('api.github') ? JSON.stringify(release) : url.includes('SHA256SUMS') ? `${'a'.repeat(64)}  ${release.assets[0]!.name}` : 'bad')))
  const { service } = make(); await service.check()
  expect((await service.download()).phase).toBe('error')
  expect(service.status().error).toContain('checksum')
})
it.runIf(APP_AUTO_UPDATE)('auto-downloads in the service without asking Electron to restart anything', async () => {
  vi.useFakeTimers()
  const { service } = make({ appUpdateChecks: false, appAutoUpdate: true })
  vi.spyOn(service, 'check').mockResolvedValue({ ...service.status(), phase: 'available' })
  const download = vi.spyOn(service, 'download').mockResolvedValue({ ...service.status(), phase: 'ready' })
  await vi.advanceTimersByTimeAsync(45_000)
  expect(download).toHaveBeenCalledOnce()
  service.close(); await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
  expect(download).toHaveBeenCalledOnce()
})
it.skipIf(APP_AUTO_UPDATE)('checks but never downloads while unsigned builds cannot self-install, even with a saved auto-update preference', async () => {
  vi.useFakeTimers()
  const { service } = make({ appUpdateChecks: false, appAutoUpdate: true })
  const check = vi.spyOn(service, 'check').mockResolvedValue({ ...service.status(), phase: 'available' })
  const download = vi.spyOn(service, 'download').mockResolvedValue({ ...service.status(), phase: 'ready' })
  await vi.advanceTimersByTimeAsync(45_000)
  expect(check).toHaveBeenCalledOnce()
  expect(download).not.toHaveBeenCalled()
  service.close()
})
it('service identity changes with shared code, independent of filesystem timestamps', () => {
  const { dir } = make()
  const daemon = join(dir, 'daemon.js'); writeFileSync(daemon, 'entry'); writeFileSync(join(dir, 'shared.js'), 'v1')
  const original = runtimeBuild(daemon)
  expect(runtimeBuild(daemon)).toBe(original)
  writeFileSync(join(dir, 'shared.js'), 'v2')
  expect(runtimeBuild(daemon)).not.toBe(original)
})

