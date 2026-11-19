import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

const shown: { title: string; click: () => void }[] = []
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => true
    private handlers: Record<string, () => void> = {}
    constructor(private readonly options: { title: string }) {}
    on(event: string, handler: () => void) {
      this.handlers[event] = handler
    }
    show() {
      shown.push({ title: this.options.title, click: () => this.handlers.click?.() })
    }
    close() {}
  },
}))
const { createPairingNotifier } = await import('../src/main/pairingNotifier')

afterEach(() => {
  shown.length = 0
  vi.useRealTimers()
})

function setup(launchedForRequest: boolean, focused = false) {
  const state = { visible: !launchedForRequest, focused }
  const window = {
    isDestroyed: () => false,
    isVisible: () => state.visible,
    isFocused: () => state.focused,
    isMinimized: () => false,
    restore: () => {},
    show: () => (state.visible = true),
    focus: () => (state.focused = true),
  } as unknown as BrowserWindow
  const quit = vi.fn()
  return { notifier: createPairingNotifier({ window, launchedForRequest, quit }), quit, state }
}
const request = (id: string, expiresAt = Date.now() + 60_000) => ({ id, name: 'Phone', code: '123456', expiresAt })

it('notifies once per request while the window is not in front, and a click brings the window up', () => {
  const { notifier, state } = setup(false)
  notifier.receive([request('a')])
  notifier.receive([request('a')])
  expect(shown.map((entry) => entry.title)).toHaveLength(1)
  shown[0]!.click()
  expect(state).toMatchObject({ visible: true, focused: true })
})

it('lets the open window show the request itself', () => {
  const { notifier } = setup(false, true)
  notifier.receive([request('a')])
  expect(shown).toEqual([])
})

it('quits an app opened only for a request once nothing is left to answer, unless the person opened it', () => {
  vi.useFakeTimers()
  const lapsing = setup(true)
  lapsing.notifier.receive([request('a', Date.now() + 5_000)])
  expect(lapsing.quit).not.toHaveBeenCalled()
  vi.advanceTimersByTime(6_100)
  expect(lapsing.quit).toHaveBeenCalledTimes(1)

  const answered = setup(true)
  answered.notifier.receive([request('a')])
  answered.notifier.receive([])
  expect(answered.quit).toHaveBeenCalledTimes(1)

  const kept = setup(true)
  kept.notifier.receive([request('a')])
  shown.at(-1)!.click()
  kept.notifier.receive([])
  expect(kept.quit).not.toHaveBeenCalled()
})
