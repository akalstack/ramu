import { expect, it } from 'vitest'
import { CustomAgentStore, STARTER_AGENTS } from '../src/agent/customAgents'

const memory = () => {
  const state = new Map<string, unknown>()
  return {
    getAppState: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
    setAppState: (key: string, value: unknown) => void state.set(key, value),
  }
}
const input = (name: string) => ({ name, description: 'd', instructions: 'i', model: null, readOnly: true })

it('saves, renames and removes custom agents, refusing a second one with the same name', () => {
  const store = new CustomAgentStore(memory())
  const starters = store.list().length
  const saved = store.save(input('Reviewer'))
  expect(store.list()).toHaveLength(starters + 1)
  expect(() => store.save(input('reviewer'))).toThrow(/already exists/)
  store.save({ ...saved, name: 'Strict reviewer' })
  expect(store.list().map((agent) => agent.name)).toContain('Strict reviewer')
  store.remove(saved.id)
  expect(store.list()).toHaveLength(starters)
})

it('starts a new host with ready teammates, once, and never brings deleted ones back', () => {
  const state = memory()
  const store = new CustomAgentStore(state)
  const first = store.list()
  expect(first.map((agent) => agent.name)).toEqual(STARTER_AGENTS.map((agent) => agent.name))
  // Stable ids across reads, so editing one edits that one.
  expect(store.list().map((agent) => agent.id)).toEqual(first.map((agent) => agent.id))
  for (const agent of first) store.remove(agent.id)
  expect(new CustomAgentStore(state).list()).toEqual([])
  // A host that already saved its own agents gets no starters added.
  const own = memory()
  own.setAppState('custom-agents', [{ ...input('mine'), id: 'x', updatedAt: 1 }])
  expect(new CustomAgentStore(own).list().map((agent) => agent.name)).toEqual(['mine'])
})
