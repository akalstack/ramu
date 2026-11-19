import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { modelChoice } from '@ramu/shared/workspace/agentDefaults'
import { clearAgentDraft, loadAgentDraft, saveAgentDraft } from '../src/composer/agentDraft'
import { hostStore, type Store } from '../src/hostStorage'
function storage(): Store {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}
const choice = {
  version: 1 as const,
  selection: modelChoice({ ...DEFAULT_AGENT_SETTINGS, provider: 'codex', model: 'manual-model' }),
}
it('restores explicit model provenance by host/project and clears only the sent choice', () => {
  const store = storage(),
    a = hostStore(store, 'a'),
    b = hostStore(store, 'b')
  expect(saveAgentDraft('p', choice, a, 100)).toBe(true)
  expect(loadAgentDraft('p', a, 200).choice).toEqual(choice)
  expect(loadAgentDraft('p', b, 200).choice).toEqual({ version: 1 })
  expect(loadAgentDraft('other', a, 200).choice).toEqual({ version: 1 })
  const newer = { ...choice, selection: { ...choice.selection, model: 'newer' } }
  saveAgentDraft('p', newer, a)
  expect(clearAgentDraft('p', choice, a)).toBe(false)
  expect(loadAgentDraft('p', a).choice).toEqual(newer)
  expect(clearAgentDraft('p', newer, a)).toBe(true)
  const now = Date.now()
  saveAgentDraft('p', choice, a, now)
  const sent = loadAgentDraft('p', a)
  saveAgentDraft('p', choice, a, now + 1)
  expect(clearAgentDraft('p', choice, a, sent.serialized)).toBe(false)
  expect(loadAgentDraft('p', a).choice).toEqual(choice)
})
it('retains unreadable and unsupported metadata until an explicit choice replaces it; automatic drafts expire', () => {
  const store = storage()
  for (const raw of ['{', '{"version":9}', 'x'.repeat(8193)]) {
    store.setItem('ramu.new-thread-agent:p', raw)
    expect(loadAgentDraft('p', store).problem).toBeTruthy()
    expect(clearAgentDraft('p', { version: 1 }, store)).toBe(false)
    expect(store.getItem('ramu.new-thread-agent:p')).toBe(raw)
  }
  saveAgentDraft('p', choice, store, 1)
  expect(loadAgentDraft('p', store, 31 * 24 * 60 * 60 * 1000).choice).toEqual({ version: 1 })
  expect(loadAgentDraft('p', null).problem).toBe('storage')
  expect(saveAgentDraft('p', choice, null)).toBe(false)
  const denied = {
    ...store,
    setItem() {
      throw Error('Quota exceeded')
    },
  }
  expect(saveAgentDraft('p', choice, denied)).toBe(false)
  expect(loadAgentDraft('p', store, 2).choice).toEqual(choice)
})
