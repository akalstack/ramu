import { expect, it, vi, type Mock } from 'vitest'
import { executeBrowserBridge } from '../src/browser/browserBridge'
import type { BrowserRuntime } from '../src/browser/browserRuntime'
import type { BrowserViewerOperation } from '@ramu/shared/browserBridge'

const TAB = 'tab-1'
type Mocked = Record<
  'requireHumanDevice' | 'adoptReleased' | 'takeControl' | 'navigate' | 'close' | 'controllerDisconnected',
  Mock
>
const runtime = () =>
  ({
    list: vi.fn(() => [{ id: TAB }]),
    adoptReleased: vi.fn(),
    takeControl: vi.fn(() => ({ id: TAB, controller: 'human' })),
    requireHumanDevice: vi.fn(),
    navigate: vi.fn(async () => ({ id: TAB })),
    inputAsHuman: vi.fn(async () => {}),
    controllerDisconnected: vi.fn(),
    captureForViewer: vi.fn(async () => ({ data: 'x' })),
    close: vi.fn(),
  }) as unknown as BrowserRuntime & Mocked
const run = (r: BrowserRuntime, operation: BrowserViewerOperation) =>
  executeBrowserBridge(r, 'desktop', {
    requestId: 'r',
    clientId: 'c',
    threadId: 'thread',
    runId: 'viewer',
    expiresAt: Date.now() + 1000,
    command: { kind: 'viewer', device: 'phone', operation },
  })

it('answers a paired device as that device, never adopting a released tab for an agent run', async () => {
  const r = runtime()
  await run(r, { op: 'frame', tabId: TAB })
  await run(r, { op: 'take', tabId: TAB })
  expect(r.adoptReleased).not.toHaveBeenCalled()
  expect(r.takeControl).toHaveBeenCalledWith(TAB, 'phone')
})

it('requires this device to hold the tab before navigating, typing or closing', async () => {
  const r = runtime()
  r.requireHumanDevice.mockImplementation(() => {
    throw new Error('Take control first.')
  })
  await expect(run(r, { op: 'navigate', tabId: TAB, url: 'https://a.test' })).rejects.toThrow('Take control')
  await expect(run(r, { op: 'close', tabId: TAB })).rejects.toThrow('Take control')
  expect(r.navigate).not.toHaveBeenCalled()
  expect(r.close).not.toHaveBeenCalled()
})

it('refuses another thread’s tab and pauses the device’s control on disconnect', async () => {
  const r = runtime()
  await expect(run(r, { op: 'frame', tabId: 'other' })).rejects.toThrow('another thread')
  await run(r, { op: 'disconnect' })
  expect(r.controllerDisconnected).toHaveBeenCalledWith('phone')
})

it('scopes live compositor reads to the thread and validates their cursor', async () => {
  const r = runtime()
  r.nextFrameForViewer = vi.fn(async () => null)
  await run(r, { op: 'nextFrame', tabId: TAB, after: 3 })
  expect(r.nextFrameForViewer).toHaveBeenCalledWith(TAB, { hostId: 'desktop', threadId: 'thread' }, 3)
  await expect(run(r, { op: 'nextFrame', tabId: 'other', after: 0 })).rejects.toThrow('another thread')
  await expect(run(r, { op: 'nextFrame', tabId: TAB, after: -1 })).rejects.toThrow('cursor')
})
