import { describe, expect, it, vi } from 'vitest'
import { readTranscriptChanges, type TranscriptChanges } from '../src/transcriptChanges'

const row = (seq: number) => ({ seq, event: { kind: 'text', text: String(seq) } as never })
const answer = (cursor: number, seqs: number[], extra: Partial<TranscriptChanges> = {}): TranscriptChanges => ({
  reset: false,
  cursor,
  lastSeq: 9,
  revision: 1,
  events: seqs.map(row),
  ...extra,
})

describe('readTranscriptChanges', () => {
  it('joins the parts of a long catch-up, each asked from where the last ended', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(answer(20, [1, 2], { more: true }))
      .mockResolvedValueOnce(answer(40, [3, 2], { more: true }))
      .mockResolvedValueOnce(answer(55, [4]))
    const result = await readTranscriptChanges(read, 5, 9, {})
    expect(read.mock.calls).toEqual([
      [5, 9, true, 0],
      [20, 9, true, 0],
      [40, 9, true, 0],
    ])
    expect(result).toMatchObject({ reset: false, cursor: 55 })
    expect(result.events.map((entry) => entry.seq)).toEqual([1, 2, 3, 2, 4])
    expect(result.more).toBeUndefined()
  })

  it('takes a snapshot that arrives midway instead of the parts before it', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(answer(20, [1], { more: true }))
      .mockResolvedValueOnce(answer(60, [1, 2, 3], { reset: true }))
    const result = await readTranscriptChanges(read, 5, 9, {})
    expect(result.reset).toBe(true)
    expect(result.events.map((entry) => entry.seq)).toEqual([1, 2, 3])
  })

  it('asks an older host the old way, and remembers it', async () => {
    const host: { unpaged?: boolean } = {}
    const read = vi.fn(async (_cursor: number, _known: number, paged: boolean) => {
      if (paged) throw new Error('Expected 3 arguments')
      return answer(30, [1])
    })
    expect((await readTranscriptChanges(read, 5, 9, host)).cursor).toBe(30)
    expect(host.unpaged).toBe(true)
    await readTranscriptChanges(read, 30, 9, host)
    expect(read.mock.calls.at(-1)).toEqual([30, 9, false])
  })

  it('reports a failure that is not about parts as it is', async () => {
    const host: { unpaged?: boolean } = {}
    const read = vi.fn(async () => {
      throw new Error('That thread no longer exists')
    })
    await expect(readTranscriptChanges(read, 5, 9, host)).rejects.toThrow('no longer exists')
    expect(host.unpaged).toBeUndefined()
  })

  it('gathers a snapshot sent in parts and keeps the cursor of its first part', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(answer(70, [1, 2], { reset: true, more: true, after: 2 }))
      .mockResolvedValueOnce(answer(75, [3, 4], { more: true, after: 4 }))
      .mockResolvedValueOnce(answer(80, [5]))
    const result = await readTranscriptChanges(read, 0, 0, {})
    expect(read.mock.calls.map((call) => call[3])).toEqual([0, 2, 4])
    expect(result).toMatchObject({ reset: true, cursor: 70 })
    expect(result.events.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('asks a host that sends snapshots whole without the snapshot argument, and remembers it', async () => {
    const host: { unpaged?: boolean; wholeSnapshots?: boolean } = {}
    const read = vi.fn(async (_cursor: number, _known: number, _paged: boolean, after?: number) => {
      if (after !== undefined) throw new Error('Expected 4 arguments')
      return answer(30, [1, 2, 3], { reset: true })
    })
    expect((await readTranscriptChanges(read, 0, 0, host)).events).toHaveLength(3)
    expect(host).toEqual({ wholeSnapshots: true })
    await readTranscriptChanges(read, 30, 3, host)
    expect(read.mock.calls.at(-1)).toEqual([30, 3, true])
  })
})
