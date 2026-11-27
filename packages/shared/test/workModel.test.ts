import { expect, it } from 'vitest'
import { resolveWorkModel, withWorkModel } from '../src/providers/workModel'
import { DEFAULT_AGENT_SETTINGS, type ModelPreferences } from '../src/types'

const models: ModelPreferences = {
  sets: [
    { id: 's', name: 'Set', steps: [{ id: 'd', name: 'Default', provider: 'codex', model: 'gpt', effort: 'medium' }] },
  ],
  defaultSetId: 's',
  defaultStepId: 'd',
}
const thread = { ...DEFAULT_AGENT_SETTINGS, provider: 'claude-code' as const, model: 'opus', accountId: 'work' }

it('runs on the thread’s model and login unless a setting names another', () => {
  expect(resolveWorkModel(null, { thread, models })).toMatchObject({ model: 'opus', accountId: 'work' })
  expect(resolveWorkModel({ use: 'thread' }, { thread, models })).toMatchObject({ model: 'opus', accountId: 'work' })
  expect(resolveWorkModel({ use: 'default' }, { thread, models })).toEqual({
    provider: 'codex',
    model: 'gpt',
    effort: 'medium',
  })
  const chosen = { provider: 'claude-code' as const, model: 'haiku', effort: null, accountId: 'personal' }
  expect(resolveWorkModel(chosen, { thread, models })).toBe(chosen)
})

it('falls back to whichever of the thread and the default model is known', () => {
  expect(resolveWorkModel(null, { models })).toMatchObject({ model: 'gpt' })
  expect(resolveWorkModel({ use: 'default' }, { thread })).toMatchObject({ model: 'opus' })
  expect(resolveWorkModel(null, {})).toBeNull()
})

it('keeps the thread’s login only for its own provider when the choice names none', () => {
  expect(withWorkModel(thread, { provider: 'claude-code', model: 'haiku', effort: null }).accountId).toBe('work')
  expect(withWorkModel(thread, { provider: 'codex', model: 'gpt', effort: null }).accountId).toBeUndefined()
  expect(
    withWorkModel(thread, { provider: 'claude-code', model: 'haiku', effort: null, accountId: 'personal' }).accountId,
  ).toBe('personal')
  expect(withWorkModel(thread, null)).toBe(thread)
})
