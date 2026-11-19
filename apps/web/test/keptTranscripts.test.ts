import { afterEach, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSessionInfo } from '@ramu/shared/types'
import {
  createTranscriptKeeper,
  MAX_KEPT_TRANSCRIPTS,
  MAX_TRANSCRIPT_CHARS,
  readKeptTranscript,
  writeKeptTranscript,
} from '../src/views/agent/lib/keptTranscripts'

afterEach(() => vi.useRealTimers())

const memory = () => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}
const rows = (...texts: string[]) =>
  new Map<number, { event: AgentEvent }>(texts.map((text, index) => [index + 1, { event: { kind: 'user', text } }]))
const session = { id: 's', taskId: 't' } as unknown as AgentSessionInfo

it('reads back a thread’s session and rows in host order', () => {
  const store = memory()
  writeKeptTranscript(store, 's', {
    session,
    rows: new Map([...rows('b')].map(([, v]) => [5, v])).set(2, { event: { kind: 'user', text: 'a' } }),
  })
  const kept = readKeptTranscript(store, 's')
  expect(kept?.session).toEqual(session)
  expect([...kept!.rows.keys()]).toEqual([2, 5])
})

it('keeps only the most recent threads, dropping the least recently saved', () => {
  const store = memory()
  for (let index = 0; index <= MAX_KEPT_TRANSCRIPTS; index++)
    writeKeptTranscript(store, `s${index}`, { session: null, rows: rows('hi') })
  expect(readKeptTranscript(store, 's0')).toBeNull()
  expect(readKeptTranscript(store, `s${MAX_KEPT_TRANSCRIPTS}`)?.rows.size).toBe(1)
})

it('leaves out the oldest rows of a thread too long to keep whole', () => {
  const store = memory()
  const long = 'x'.repeat(MAX_TRANSCRIPT_CHARS / 4)
  writeKeptTranscript(store, 's', { session, rows: rows(long, long, long, long, long, 'last') })
  const kept = readKeptTranscript(store, 's')!
  expect(store.data.get('ramu.transcript.s')!.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS)
  expect([...kept.rows.values()].at(-1)?.event).toEqual({ kind: 'user', text: 'last' })
  expect(kept.rows.has(1)).toBe(false)
  expect(kept.session).toEqual(session)
})

it('coalesces a streaming thread’s saves and merges its session with its rows', () => {
  vi.useFakeTimers()
  const store = memory()
  const setItem = vi.spyOn(store, 'setItem')
  const keeper = createTranscriptKeeper((host) => (host === 'studio' ? store : null), 1000)
  keeper.keep('studio', 's', { rows: rows('a') })
  keeper.keep('studio', 's', { session })
  keeper.keep('studio', 's', { rows: rows('a', 'b') })
  keeper.keep('local', 's', { session })
  // Waiting saves are already visible to a chat opened meanwhile.
  expect(keeper.read('studio', 's')?.rows.size).toBe(2)
  expect(setItem).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1000)
  expect(readKeptTranscript(store, 's')).toMatchObject({ session, rows: rows('a', 'b') })
  expect(keeper.read('local', 's')).toBeNull()
})
