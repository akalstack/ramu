import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type ModelPreferences } from '@ramu/shared/types'
import { writingSettings } from '../src/ipc/helpers'

const models: ModelPreferences = {
  sets: [
    { id: 's', name: 'Set', steps: [{ id: 'd', name: 'Default', provider: 'codex', model: 'gpt', effort: 'low' }] },
  ],
  defaultSetId: 's',
  defaultStepId: 'd',
}
const workspace = {
  getAppState: <T>(key: string, fallback: T) => (key === 'model-preferences' ? models : fallback) as T,
}
const thread = {
  ...DEFAULT_AGENT_SETTINGS,
  provider: 'claude-code' as const,
  model: 'opus',
  accountId: 'work',
  serviceTier: 'fast' as const,
}

it('writes commits and pull requests on the thread’s own model and login unless another is chosen', () => {
  expect(writingSettings(workspace, { commitModel: null }, thread)).toEqual(thread)
  const byDefault = writingSettings(workspace, { commitModel: { use: 'default' } }, thread)!
  expect(byDefault).toMatchObject({ provider: 'codex', model: 'gpt' })
  // Another provider's login and the thread's fast tier do not carry over.
  expect(byDefault.accountId).toBeUndefined()
  expect(byDefault.serviceTier).toBeUndefined()
  expect(
    writingSettings(
      workspace,
      { commitModel: { provider: 'claude-code', model: 'haiku', effort: null, accountId: 'personal' } },
      thread,
    ),
  ).toMatchObject({ model: 'haiku', accountId: 'personal' })
  // Without a thread, such as a draft for a branch no agent worked on, the default model writes.
  expect(writingSettings(workspace, { commitModel: null })).toMatchObject({ model: 'gpt' })
})
