import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  exists: false,
  callbacks: [] as ((error: Error | null) => void)[],
}))
vi.mock('node:fs', () => ({ existsSync: () => state.exists }))
vi.mock('playwright-core', () => ({ chromium: { executablePath: () => '/managed/chromium' } }))
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_command, _args, _options, callback) => {
    state.callbacks.push(callback)
  }),
}))
import { execFile } from 'node:child_process'
import { ensureInteractiveBrowser, interactiveBrowserPath } from '../src/interactive/browser'
afterEach(() => {
  state.exists = false
  state.callbacks = []
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

it('reuses the compatible managed browser without starting an installer', async () => {
  state.exists = true
  expect(await ensureInteractiveBrowser()).toBe('/managed/chromium')
  expect(execFile).not.toHaveBeenCalled()
})
it('downloads once for concurrent callers and reuses the installed executable', async () => {
  const first = ensureInteractiveBrowser()
  const second = ensureInteractiveBrowser()
  expect(execFile).toHaveBeenCalledTimes(1)
  expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['install', 'chromium', '--no-shell']))
  state.exists = true
  state.callbacks[0]!(null)
  expect(await Promise.all([first, second])).toEqual(['/managed/chromium', '/managed/chromium'])
})
it('lets one preview cancel while another continues installing', async () => {
  const controller = new AbortController()
  const first = ensureInteractiveBrowser(controller.signal)
  const second = ensureInteractiveBrowser()
  controller.abort()
  await expect(first).rejects.toThrow('Preview cancelled')
  state.exists = true
  state.callbacks[0]!(null)
  expect(await second).toBe('/managed/chromium')
})
it('reports failed installation and allows a later retry', async () => {
  const first = ensureInteractiveBrowser()
  state.callbacks[0]!(new Error('private installer diagnostics'))
  await expect(first).rejects.toThrow('Could not download the preview browser')
  const second = ensureInteractiveBrowser()
  expect(execFile).toHaveBeenCalledTimes(2)
  state.exists = true
  state.callbacks[1]!(null)
  expect(await second).toBe('/managed/chromium')
})
it('honors an explicit host override and diagnoses an invalid override without downloading', async () => {
  vi.stubEnv('RAMU_INTERACTIVE_BROWSER', '/custom/chromium')
  await expect(ensureInteractiveBrowser()).rejects.toThrow('existing executable')
  state.exists = true
  expect(interactiveBrowserPath()).toBe('/custom/chromium')
  expect(await ensureInteractiveBrowser()).toBe('/custom/chromium')
  expect(execFile).not.toHaveBeenCalled()
})
it('does not start installing for an already cancelled preview', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(ensureInteractiveBrowser(controller.signal)).rejects.toThrow('Preview cancelled')
  expect(execFile).not.toHaveBeenCalled()
})
