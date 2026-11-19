import { expect, it } from 'vitest'
import { clearDraft, draftKey, loadDraft, pruneDrafts, saveDraft } from '../src/composer/drafts'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}

it('restores text saved for a thread and keeps threads and projects apart', () => {
  const store = memory()
  saveDraft(draftKey.chat('a'), 'half-written message', store)
  saveDraft(draftKey.newChat('a'), 'new thread idea', store)
  expect(loadDraft(draftKey.chat('a'), store)).toBe('half-written message')
  expect(loadDraft(draftKey.newChat('a'), store)).toBe('new thread idea')
  expect(loadDraft(draftKey.chat('b'), store)).toBe('')
})

it('removes the draft when the text is cleared or only whitespace', () => {
  const store = memory()
  saveDraft('chat:a', 'text', store)
  saveDraft('chat:a', '  \n ', store)
  expect(store.length).toBe(0)
  saveDraft('chat:a', 'again', store)
  clearDraft('chat:a', store)
  expect(loadDraft('chat:a', store)).toBe('')
})

it('forgets drafts older than 30 days and ignores corrupt entries', () => {
  const store = memory(),
    day = 24 * 60 * 60 * 1000,
    now = Date.now()
  saveDraft('chat:old', 'stale', store, now - 31 * day)
  saveDraft('chat:fresh', 'recent', store, now - 29 * day)
  store.setItem('ramu.draft.chat:bad', '{not json')
  store.setItem('other.key', 'untouched')
  expect(loadDraft('chat:bad', store, now)).toBe('')
  pruneDrafts(store, now)
  expect(loadDraft('chat:fresh', store, now)).toBe('recent')
  expect(store.getItem('ramu.draft.chat:old')).toBeNull()
  expect(store.getItem('other.key')).toBe('untouched')
})

it('survives storage that throws', () => {
  const broken = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('quota')
    },
    removeItem: () => {
      throw new Error('denied')
    },
    key: () => null,
    length: 0,
  }
  expect(() => saveDraft('chat:a', 'text', broken)).not.toThrow()
  expect(loadDraft('chat:a', broken)).toBe('')
  expect(() => clearDraft('chat:a', broken)).not.toThrow()
})

it('caps very large drafts', () => {
  const store = memory()
  saveDraft('chat:a', 'x'.repeat(500_000), store)
  expect(loadDraft('chat:a', store)).toHaveLength(200_000)
})
