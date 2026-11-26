import { expect, it } from 'vitest'
import { loadFailedSubmissions, saveFailedSubmissions } from '../src/views/agent/lib/failedSubmissions'
import type { PendingSubmission } from '../src/views/agent/lib/pendingSubmission'

const memory = () => {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  }
}
const send = (id: string, state: PendingSubmission['state']): PendingSubmission => ({
  id,
  text: `message ${id}`,
  attachments: [],
  afterEvent: 4,
  queuedIds: [],
  sentAt: 1,
  state,
  ...(state === 'failed' ? { error: 'Connection lost' } : {}),
  payload: { outgoing: `message ${id}`, mode: 'queue', context: [], compactFirst: false, reviews: [] },
})

it('keeps only the sends that failed, and gives them back after the thread is reopened', () => {
  const store = memory()
  saveFailedSubmissions(store, 's1', [send('a', 'failed'), send('b', 'sending'), send('c', 'sent')])
  expect(loadFailedSubmissions(store, 's1')).toEqual([send('a', 'failed')])
  expect(loadFailedSubmissions(store, 's2')).toEqual([])
})

it('forgets the thread once nothing failed is left, and ignores what it cannot read', () => {
  const store = memory()
  saveFailedSubmissions(store, 's1', [send('a', 'failed')])
  saveFailedSubmissions(store, 's1', [])
  expect(store.entries.size).toBe(0)
  store.setItem('ramu.failed-sends.s1', '{not json')
  expect(loadFailedSubmissions(store, 's1')).toEqual([])
  store.setItem('ramu.failed-sends.s1', JSON.stringify([{ id: 'x' }, send('a', 'failed')]))
  expect(loadFailedSubmissions(store, 's1').map((item) => item.id)).toEqual(['a'])
})
