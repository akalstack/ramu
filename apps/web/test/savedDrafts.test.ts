import { expect, it } from 'vitest'
import { SavedDraftError, type MessageDraftSnapshot, type SavedDraftScope } from '@ramu/shared/chat/savedDrafts'
import { commitSavedDraftMove, loadSavedDrafts, SAVED_DRAFTS_KEY, savedDraftPreview } from '../src/composer/savedDrafts'

function memory(failWrites = false) {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('quota')
      data.set(key, value)
    },
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}
const scope: SavedDraftScope = { kind: 'thread', id: 'a' }
const message = (text: string): MessageDraftSnapshot => ({ text, attachments: [], context: [], mentions: [] })

it('saves a message, empties the composer and restores it', () => {
  const store = memory()
  const saved = commitSavedDraftMove({
    host: 'h1',
    scope,
    active: message('half done'),
    command: { kind: 'save', id: 's1', at: 1 },
    store,
  })
  expect(saved.active.text).toBe('')
  expect(loadSavedDrafts('h1', store).items.map((item) => item.snapshot.text)).toEqual(['half done'])
  const restored = commitSavedDraftMove({
    host: 'h1',
    scope,
    active: message(''),
    command: { kind: 'restore', id: 's1', itemRevision: 1, at: 2 },
    store,
  })
  expect(restored.active.text).toBe('half done')
  expect(loadSavedDrafts('h1', store).items).toEqual([])
})

it('keeps the source and the message when the write fails', () => {
  const store = memory(true)
  expect(() =>
    commitSavedDraftMove({
      host: 'h1',
      scope,
      active: message('keep me'),
      command: { kind: 'save', id: 's1', at: 1 },
      store,
    }),
  ).toThrow(SavedDraftError)
  expect(store.getItem(SAVED_DRAFTS_KEY)).toBeNull()
})

it('refuses to treat unreadable data as an empty library', () => {
  const store = memory()
  store.setItem(SAVED_DRAFTS_KEY, '{"version":2}')
  expect(() => loadSavedDrafts('h1', store)).toThrow(SavedDraftError)
  expect(() =>
    commitSavedDraftMove({ host: 'h1', scope, active: message('x'), command: { kind: 'save', id: 's', at: 1 }, store }),
  ).toThrow(SavedDraftError)
  expect(store.getItem(SAVED_DRAFTS_KEY)).toBe('{"version":2}')
})

it('previews the first non-empty line', () => {
  expect(savedDraftPreview(message('\n\n  hello\nworld'))).toBe('hello')
  expect(savedDraftPreview(message('x'.repeat(200))).length).toBe(80)
})
