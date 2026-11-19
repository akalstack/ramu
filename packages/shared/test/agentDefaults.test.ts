import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../src/types'
import {
  agentSettingsForDraft,
  editAgentDraft,
  modelChoice,
  parseAgentDraft,
  routedAgentSettings,
  type ProjectAgentDefaults,
} from '../src/workspace/agentDefaults'
const base: AgentSettings = {
  ...DEFAULT_AGENT_SETTINGS,
  provider: 'codex',
  model: 'host-model',
  effort: 'high',
  access: 'edits',
  autoFallback: false,
  accountId: 'work',
  serviceTier: 'fast',
}
const repository: ProjectAgentDefaults = {
  status: 'ready',
  source: 'ramu.json',
  requested: { provider: 'claude-code', model: 'repository-model' },
  selection: { provider: 'claude-code', model: 'repository-model', effort: 'medium' },
}
it('uses repository model defaults without importing permissions or another provider account/tier', () => {
  expect(agentSettingsForDraft(base, repository, { version: 1 })).toEqual({
    ...base,
    ...repository.selection,
    accountId: undefined,
    serviceTier: 'standard',
  })
  const sameProvider = {
    ...repository,
    selection: { provider: 'codex' as const, model: 'other-codex-model', effort: null },
  }
  expect(agentSettingsForDraft(base, sameProvider, { version: 1 })).toMatchObject({
    accountId: 'work',
    serviceTier: 'standard',
    access: 'edits',
    autoFallback: false,
  })
  expect(agentSettingsForDraft(base, { status: 'none' }, { version: 1 })).toEqual(base)
})
it('preserves explicit models across changed defaults while behavior-only edits continue following repository models', () => {
  const current = agentSettingsForDraft(base, repository, { version: 1 })
  const behavior = editAgentDraft({ version: 1 }, current, { ...current, access: 'auto' })
  expect(behavior.selection).toBeUndefined()
  const changed = { ...repository, selection: { ...repository.selection!, model: 'replacement' } }
  expect(agentSettingsForDraft(base, changed, behavior)).toMatchObject({ model: 'replacement', access: 'auto' })
  const manual = editAgentDraft(behavior, agentSettingsForDraft(base, repository, behavior), {
    ...base,
    model: 'chosen',
  })
  expect(agentSettingsForDraft(base, changed, manual)).toMatchObject({
    provider: 'codex',
    model: 'chosen',
    access: 'edits',
    accountId: 'work',
    serviceTier: 'fast',
  })
  expect(editAgentDraft({ version: 1 }, current, current).selection).toEqual(modelChoice(current))
})
it('validates versioned explicit choices without accepting repository authority or silently resetting malformed data', () => {
  const value = { version: 1, at: 123, selection: modelChoice(base), behavior: { access: 'auto', autoFallback: true } }
  expect(parseAgentDraft(value)).toEqual({ version: 1, selection: modelChoice(base), behavior: value.behavior })
  for (const invalid of [
    { ...value, version: 2 },
    { ...value, selection: { ...value.selection, provider: 'unknown' } },
    { ...value, selection: { ...value.selection, effort: 'imaginary' } },
    { ...value, selection: { ...value.selection, binary: '/unsafe' } },
    { ...value, selection: { ...value.selection, model: 'x'.repeat(201) } },
    { ...value, behavior: { access: 'ask', autoFallback: true } },
    { ...value, credentials: 'secret' },
  ])
    expect(parseAgentDraft(invalid)).toBeNull()
})
it('applies a routed destination’s repository defaults unless the draft chose a model', () => {
  const draft = { version: 1 as const, behavior: { access: 'full' as const, autoFallback: true } }
  expect(routedAgentSettings(base, repository, draft)).toEqual(agentSettingsForDraft(base, repository, draft))
  expect(routedAgentSettings(base, repository, draft)).toMatchObject({ model: 'repository-model', access: 'full' })
  const explicit = { version: 1 as const, selection: modelChoice({ ...base, model: 'picked' }) }
  expect(routedAgentSettings(base, repository, explicit)).toMatchObject({ provider: 'codex', model: 'picked' })
  expect(routedAgentSettings(base, { status: 'none' }, { version: 1 })).toEqual(base)
  expect(routedAgentSettings(base, undefined, { version: 1 })).toEqual(base)
  for (const status of ['unavailable', 'invalid'] as const) {
    expect(routedAgentSettings(base, { status, reason: 'model' }, { version: 1 })).toBeNull()
    expect(routedAgentSettings(base, { status }, explicit)).toMatchObject({ model: 'picked' })
  }
})
