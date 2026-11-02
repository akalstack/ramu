import { expect, it } from 'vitest'
import { CustomAgentStore } from '../src/agent/customAgents'

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
  const saved = store.save(input('Reviewer'))
  expect(store.list()).toHaveLength(1)
  expect(() => store.save(input('reviewer'))).toThrow(/already exists/)
  store.save({ ...saved, name: 'Strict reviewer' })
  expect(store.list().map((agent) => agent.name)).toEqual(['Strict reviewer'])
  store.remove(saved.id)
  expect(store.list()).toEqual([])
})
