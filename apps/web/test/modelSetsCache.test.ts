import { describe, expect, it, vi } from 'vitest'
import { cachedModelSets, rememberModelSets, warmModelSets } from '../src/models/modelSetsCache'

const catalog = [{ provider: 'codex', models: [] }]
const stored = { sets: [], defaultSetId: 'a', defaultStepId: 'b' }

describe('model sets cache', () => {
  it('stores what a host answers so its shell can start with it', async () => {
    const invoke = vi.fn(async (method: string) => (method === 'agent.catalog' ? catalog : stored))
    await warmModelSets('host-a', invoke as never)
    expect(cachedModelSets('host-a')?.catalogs).toEqual(catalog)
    expect(cachedModelSets('host-a')?.preferences).toBeTruthy()
    await warmModelSets('host-a', invoke as never)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('stores nothing for a host that answers neither call', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('not reachable')
    })
    await warmModelSets('host-b', invoke as never)
    expect(cachedModelSets('host-b')).toBeUndefined()
  })

  it('keeps an answer the shell already remembered', async () => {
    const remembered = { preferences: stored as never, catalogs: [] }
    rememberModelSets('host-c', remembered)
    const invoke = vi.fn(async () => catalog)
    await warmModelSets('host-c', invoke as never)
    expect(invoke).not.toHaveBeenCalled()
    expect(cachedModelSets('host-c')).toBe(remembered)
  })
})
