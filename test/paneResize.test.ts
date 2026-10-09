import { afterEach, expect, it, vi } from 'vitest'
import { beginPaneResize } from '../src/shared/paneResize'

afterEach(() => vi.unstubAllGlobals())
const classes = () => {
  const values = new Set<string>()
  return { add: (value: string) => values.add(value), remove: (value: string) => values.delete(value), contains: (value: string) => values.has(value) }
}
it.each(['pointerup', 'pointercancel', 'blur'])('highlights only the active divider and cleans up on %s', (ending) => {
  const surface = new EventTarget(), handle = { classList: classes() }, other = { classList: classes() }, body = { classList: classes() }
  const move = vi.fn(), finish = vi.fn()
  const cleanup = beginPaneResize({ button: 0, pointerId: 7, currentTarget: handle, preventDefault: vi.fn() }, 'column', { surface, body }, move, finish)
  expect(handle.classList.contains('is-resizing')).toBe(true)
  expect(other.classList.contains('is-resizing')).toBe(false)
  const send = (type: string, pointerId = 7) => surface.dispatchEvent(Object.assign(new Event(type), { pointerId }))
  send('pointermove', 8); expect(move).not.toHaveBeenCalled()
  send('pointermove'); expect(move).toHaveBeenCalledTimes(1)
  send(ending); cleanup(); send('pointermove')
  expect(move).toHaveBeenCalledTimes(1)
  expect(finish).toHaveBeenCalledTimes(1)
  expect(handle.classList.contains('is-resizing')).toBe(false)
  expect(body.classList.contains('resizing')).toBe(false)
})
