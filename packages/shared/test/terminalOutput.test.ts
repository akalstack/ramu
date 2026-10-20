import { expect, it } from 'vitest'
import { TerminalOutputBuffer, terminalOutputUpdate, unseenOutput } from '../src/workspace/terminalOutput'
it('coalesces overlapping and repeated chunks before a snapshot finishes', () => {
  const buffer = new TerminalOutputBuffer({ maxChars: 20, perTerminal: 20, terminals: 1 })
  buffer.add({ id: 't', data: 'abcd', cursor: 4 })
  buffer.add({ id: 't', data: 'cdef', cursor: 6 })
  buffer.add({ id: 't', data: 'cdef', cursor: 6 })
  expect(buffer.size).toBe(6)
  expect(buffer.drain()).toEqual([{ id: 't', data: 'abcdef', cursor: 6 }])
})
it('reports discontinuity even when a producer did not explicitly mark a lost chunk', () => {
  expect(unseenOutput({ id: 't', data: 'gh', cursor: 8 }, 4)).toEqual({ data: 'gh', reset: true })
  const buffer = new TerminalOutputBuffer({ maxChars: 20, perTerminal: 20, terminals: 1 })
  buffer.add({ id: 't', data: 'ab', cursor: 2 })
  buffer.add({ id: 't', data: 'gh', cursor: 8 })
  expect(buffer.drain()).toEqual([{ id: 't', data: 'gh', cursor: 8, truncated: true }])
  expect(buffer.size).toBe(0)
})
it('appends a bounded tail without resetting scroll/selection and resets only on a gap, rewind or new identity', () => {
  const before = { session: 'host-a:task:t', output: 'abcd', cursor: 4 }
  expect(terminalOutputUpdate(before, { ...before, output: 'cdef', cursor: 6 })).toEqual({ kind: 'output', data: 'ef' })
  expect(terminalOutputUpdate(before, before)).toEqual({ kind: 'output', data: '' })
  expect(terminalOutputUpdate(before, { ...before, output: 'gh', cursor: 8 })).toEqual({ kind: 'reset', data: 'gh' })
  expect(terminalOutputUpdate(before, { ...before, output: 'ab', cursor: 2 })).toEqual({ kind: 'reset', data: 'ab' })
  expect(terminalOutputUpdate(before, { ...before, session: 'host-b:task:t' })).toEqual({ kind: 'reset', data: 'abcd' })
})
