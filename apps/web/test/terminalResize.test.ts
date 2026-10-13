import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTerminalResizeScheduler } from '../src/terminalResize'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('coalesces a continuous drag and immediately sends the final size on release', () => {
  const send = vi.fn()
  const resize = createTerminalResizeScheduler(send)
  for (let cols = 80; cols < 140; cols++) {
    resize.request(cols, 30)
    vi.advanceTimersByTime(8)
  }
  expect(send).not.toHaveBeenCalled()
  resize.flush()
  expect(send).toHaveBeenCalledExactlyOnceWith(139, 30)
  vi.runAllTimers()
  expect(send).toHaveBeenCalledOnce()
})

it('debounces ordinary window resizes and delivers a paused resize burst', () => {
  const send = vi.fn()
  const resize = createTerminalResizeScheduler(send)
  resize.request(100, 40)
  vi.advanceTimersByTime(100)
  expect(send).toHaveBeenLastCalledWith(100, 40)
  resize.request(110, 45)
  vi.advanceTimersByTime(50)
  resize.request(120, 45)
  vi.advanceTimersByTime(99)
  expect(send).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(1)
  expect(send).toHaveBeenLastCalledWith(120, 45)
})

it('never delivers a pending resize to a disposed terminal', () => {
  const send = vi.fn()
  const resize = createTerminalResizeScheduler(send)
  resize.request(100, 40)
  resize.dispose()
  vi.runAllTimers()
  resize.request(120, 50)
  resize.flush()
  expect(send).not.toHaveBeenCalled()
})
