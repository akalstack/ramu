import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppUpdateStatus } from '@ramu/shared/updates'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  updater: { on: vi.fn(), setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn() },
}))
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.2.0' }, autoUpdater: mocks.updater }))
vi.mock('node:child_process', () => ({ spawnSync: () => ({ status: 0, stderr: 'TeamIdentifier=ABCDEFGHIJ' }) }))
import { DesktopUpdater } from '../src/main/desktopUpdater'
let directory = '',
  service: DesktopUpdater | undefined
const platform = process.platform
afterEach(() => {
  service?.close()
  service = undefined
  if (directory) rmSync(directory, { recursive: true, force: true })
  Object.defineProperty(process, 'platform', { value: platform })
  vi.clearAllMocks()
  mocks.handlers.clear()
})
const make = () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  directory = mkdtempSync(join(tmpdir(), 'ramu-native-updater-'))
  mocks.updater.on.mockImplementation((name, callback) => {
    mocks.handlers.set(name, callback)
  })
  service = new DesktopUpdater(directory, vi.fn())
  return service
}
const status = (version: string): AppUpdateStatus => ({
  currentVersion: '0.1.0',
  phase: 'ready',
  checkedAt: null,
  error: null,
  downloadedBytes: 3,
  release: {
    version,
    notesUrl: `https://github.com/ahxar/ramu/releases/tag/v${version}`,
    publishedAt: '2026-10-12T00:00:00Z',
    assetName: 'darwin-arm64-Ramu.zip',
    assetUrl: 'https://github.com/ahxar/ramu/releases/download/v0.3.0/Ramu.zip',
    checksumsUrl: 'https://github.com/ahxar/ramu/releases/download/v0.3.0/SHA256SUMS.txt',
    size: 3,
  },
})
it('never downgrades a newer app just because its retained daemon has an older version', async () => {
  await make().prepare(status('0.1.5'))
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
})
it('prepares the native update but only installs after an explicit user restart action', async () => {
  const updater = make()
  mkdirSync(join(directory, 'app-updates'))
  writeFileSync(join(directory, 'app-updates', 'darwin-arm64-Ramu.zip'), 'zip')
  await updater.prepare(status('0.3.0'))
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
  const feed = (await fetch(mocks.updater.setFeedURL.mock.calls[0]![0].url).then((response) => response.json())) as {
    name: string
    url: string
  }
  expect(feed.name).toBe('Ramu 0.3.0')
  expect(await fetch(feed.url).then((response) => response.text())).toBe('zip')
  mocks.handlers.get('update-downloaded')!()
  expect(updater.ready).toBe(true)
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  updater.install()
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce()
})
