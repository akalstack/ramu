import { describe, expect, it } from 'vitest'
import { LiveBuffer, OutputWindow, planResume, type StreamWindow } from '../src/sync/streamSync'

const window: StreamWindow = { epoch: 'run-1', first: 10, last: 50 }
const bounds = { maxReplayItems: 100, maxReplayBytes: 1000 }

describe('planResume', () => {
  it('resumes live when exactly current, replays a bounded gap, and snapshots otherwise', () => {
    expect(planResume({ epoch: 'run-1', cursor: 50 }, window, bounds)).toEqual({ kind: 'live' })
    expect(planResume({ epoch: 'run-1', cursor: 40 }, window, bounds)).toEqual({ kind: 'replay', from: 41, items: 10 })
    expect(planResume({ epoch: 'run-1', cursor: 9 }, window, bounds)).toEqual({ kind: 'replay', from: 10, items: 41 })
    expect(planResume({ epoch: 'run-1', cursor: 8 }, window, bounds)).toEqual({ kind: 'snapshot', reason: 'expired' })
  })
  it('never trusts a cursor from another server run, a missing cursor or one ahead of the server', () => {
    expect(planResume({ epoch: 'run-0', cursor: 40 }, window, bounds)).toEqual({ kind: 'snapshot', reason: 'restart' })
    expect(planResume({ epoch: null, cursor: null }, window, bounds)).toEqual({ kind: 'snapshot', reason: 'no-cursor' })
    expect(planResume({ epoch: 'run-1', cursor: 99 }, window, bounds)).toEqual({ kind: 'snapshot', reason: 'ahead' })
  })
  it('falls back to a snapshot when the replay would be too large', () => {
    expect(planResume({ epoch: 'run-1', cursor: 11 }, window, { ...bounds, maxReplayItems: 10 })).toEqual({
      kind: 'snapshot',
      reason: 'too-large',
    })
    expect(planResume({ epoch: 'run-1', cursor: 40 }, { ...window, replayBytes: 5000 }, bounds)).toEqual({
      kind: 'snapshot',
      reason: 'too-large',
    })
  })
})

describe('LiveBuffer', () => {
  const item = (seq: number, size = 1) => ({ seq, size, value: `e${seq}` })
  it('drains in order after the cursor, dropping what the snapshot already covers and any repeats', () => {
    const buffer = new LiveBuffer<string>(10, 100)
    for (const seq of [7, 5, 6, 6, 8]) buffer.push(item(seq))
    expect(buffer.drainAfter(5)).toEqual(['e6', 'e7', 'e8'])
  })
  it('reports a hole instead of applying a stream with a gap', () => {
    const buffer = new LiveBuffer<string>(10, 100)
    buffer.push(item(8))
    expect(buffer.drainAfter(5)).toBeNull()
  })
  it('overflows by count or bytes and stays overflowed until resynchronized', () => {
    const byCount = new LiveBuffer<string>(2, 100)
    for (const seq of [1, 2, 3]) byCount.push(item(seq))
    expect(byCount.overflowed).toBe(true)
    expect(byCount.drainAfter(0)).toBeNull()
    const byBytes = new LiveBuffer<string>(10, 5)
    byBytes.push(item(1, 3))
    byBytes.push(item(2, 3))
    expect(byBytes.overflowed).toBe(true)
  })
})

describe('OutputWindow', () => {
  it('stops sending when full, resumes on acknowledgement and lets an oversize chunk through alone', () => {
    const window = new OutputWindow(100)
    expect(window.canSend(500)).toBe(true)
    window.sent(500)
    expect(window.canSend(1)).toBe(false)
    window.ack(500)
    expect(window.pending).toBe(0)
    window.sent(60)
    expect(window.canSend(40)).toBe(true)
    expect(window.canSend(41)).toBe(false)
    window.ack(1000)
    expect(window.pending).toBe(0)
  })
})
