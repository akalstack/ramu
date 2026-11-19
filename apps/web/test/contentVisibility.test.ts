import { afterEach, expect, it, vi } from 'vitest'
import { observeContentVisibility } from '../src/interactive/contentVisibility'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('pauses and resumes a hidden window without discarding playback, while still releasing offscreen frames', () => {
  vi.useFakeTimers()
  let intersect!: (entries: { isIntersecting: boolean }[]) => void
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  const document = Object.assign(new EventTarget(), { hidden: false })
  const callbacks = { visible: vi.fn(), hidden: vi.fn(), active: vi.fn() }
  const cleanup = observeContentVisibility({} as Element, document, callbacks)
  intersect([{ isIntersecting: true }])
  document.hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(1000)
  expect(callbacks.active).toHaveBeenLastCalledWith(false)
  expect(callbacks.hidden).not.toHaveBeenCalled()
  document.hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  expect(callbacks.active).toHaveBeenLastCalledWith(true)
  intersect([{ isIntersecting: false }])
  vi.advanceTimersByTime(100)
  intersect([{ isIntersecting: true }])
  vi.advanceTimersByTime(1000)
  expect(callbacks.hidden).not.toHaveBeenCalled()
  intersect([{ isIntersecting: false }])
  vi.advanceTimersByTime(150)
  expect(callbacks.hidden).toHaveBeenCalledOnce()
  cleanup()
  expect(disconnect).toHaveBeenCalledOnce()
  const calls = callbacks.active.mock.calls.length
  document.dispatchEvent(new Event('visibilitychange'))
  expect(callbacks.active).toHaveBeenCalledTimes(calls)
})
