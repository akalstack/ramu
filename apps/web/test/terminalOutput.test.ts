import { describe, expect, it } from 'vitest'
import { TERMINAL_BUFFER_LIMITS, TerminalOutputBuffer, unseenOutput } from '../src/workspace/terminalOutput'

describe('terminal output buffer', () => {
  it('carries over the desktop HiddenEvents limits', () => {
    expect(TERMINAL_BUFFER_LIMITS).toEqual({ maxChars: 1024 * 1024, perTerminal: 128 * 1024, terminals: 128 })
  })

  it('keeps the newest output of a terminal within its limit and marks it truncated', () => {
    const buffer = new TerminalOutputBuffer({ maxChars: 100, perTerminal: 10, terminals: 4 })
    buffer.add({ id: 'a', data: 'abcdef', cursor: 6 })
    buffer.add({ id: 'a', data: 'ghijkl', cursor: 12 })
    expect(buffer.size).toBe(10)
    expect(buffer.drain()).toEqual([{ id: 'a', data: 'cdefghijkl', cursor: 12, truncated: true }])
    expect(buffer.size).toBe(0)
    expect(buffer.drain()).toEqual([])
  })

  it('bounds the total by trimming the oldest terminal first', () => {
    const buffer = new TerminalOutputBuffer({ maxChars: 12, perTerminal: 10, terminals: 4 })
    buffer.add({ id: 'old', data: '12345678', cursor: 8 })
    buffer.add({ id: 'new', data: 'abcdefgh', cursor: 8 })
    expect(buffer.size).toBe(12)
    const [old, fresh] = buffer.drain()
    expect(old).toEqual({ id: 'old', data: '5678', cursor: 8, truncated: true })
    expect(fresh).toEqual({ id: 'new', data: 'abcdefgh', cursor: 8 })
  })

  it('holds at most the configured number of terminals, dropping the least recent', () => {
    const buffer = new TerminalOutputBuffer({ maxChars: 1000, perTerminal: 100, terminals: 2 })
    buffer.add({ id: 'a', data: 'x' })
    buffer.add({ id: 'b', data: 'y' })
    buffer.add({ id: 'a', data: 'x' })
    buffer.add({ id: 'c', data: 'z' })
    expect(buffer.drain().map((chunk) => chunk.id)).toEqual(['a', 'c'])
  })

  it('stays bounded under a flood', () => {
    const buffer = new TerminalOutputBuffer()
    const line = 'x'.repeat(4096)
    for (let i = 0; i < 2000; i++) buffer.add({ id: `t${i % 300}`, data: line, cursor: (i + 1) * 4096 })
    expect(buffer.size).toBeLessThanOrEqual(TERMINAL_BUFFER_LIMITS.maxChars)
    const chunks = buffer.drain()
    expect(chunks.length).toBeLessThanOrEqual(TERMINAL_BUFFER_LIMITS.terminals)
    for (const chunk of chunks) expect(chunk.data.length).toBeLessThanOrEqual(TERMINAL_BUFFER_LIMITS.perTerminal)
  })
})

describe('unseen output', () => {
  it('neither duplicates nor resets when a drained chunk overlaps the snapshot a view replayed', () => {
    // The view replayed a snapshot up to cursor 8; the buffer held characters 4..12 while the host was off screen.
    expect(unseenOutput({ id: 't', data: 'efghijkl', cursor: 12 }, 8)).toEqual({ data: 'ijkl', reset: false })
    // Entirely seen already.
    expect(unseenOutput({ id: 't', data: 'abcd', cursor: 8 }, 8)).toBeNull()
    // Truncated, but what was dropped is older than the snapshot: no gap, so no reset.
    expect(unseenOutput({ id: 't', data: 'efghijkl', cursor: 12, truncated: true }, 8)).toEqual({
      data: 'ijkl',
      reset: false,
    })
  })

  it('resets the view only when output between its snapshot and the chunk was lost', () => {
    expect(unseenOutput({ id: 't', data: 'uvwx', cursor: 24, truncated: true }, 8)).toEqual({
      data: 'uvwx',
      reset: true,
    })
  })

  it('writes live output as before', () => {
    expect(unseenOutput({ id: 't', data: 'ab', cursor: 2 }, 0)).toEqual({ data: 'ab', reset: false })
    expect(unseenOutput({ id: 't', data: 'ab' }, 50)).toEqual({ data: 'ab', reset: false })
  })
})
