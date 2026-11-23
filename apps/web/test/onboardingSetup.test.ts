import { describe, expect, it } from 'vitest'
import { recommendedSets, isGeneratedModelSet } from '@ramu/shared/providers/modelDefaults'
import type { AgentModel, ModelPreferences } from '@ramu/shared/types'
import {
  activeProviders,
  choosableEfforts,
  onboardingModels,
  providerChoice,
  withDefaultModel,
  withModel,
  withModelStep,
} from '../src/onboarding/defaultModel'
import { setupSteps, stepIndex } from '../src/onboarding/flow'
import { identitiesToAdd, identityDrafts, workDraft } from '../src/onboarding/identitySetup'

const model = (id: string, efforts: AgentModel['efforts'], extra: Partial<AgentModel> = {}): AgentModel => ({
  provider: 'claude-code',
  id,
  name: id,
  efforts,
  defaultEffort: efforts[1] ?? efforts[0] ?? null,
  isDefault: false,
  ...extra,
})
const sonnet = model('sonnet', ['low', 'medium', 'high'], { isDefault: true })
const opus = model('opus', ['high', 'medium', 'low', 'max'])
const haiku = model('haiku', [])
const models = [haiku, opus, sonnet]

const preferences = (): ModelPreferences => ({
  defaultBarMode: 'model',
  sets: [
    {
      id: 'mine',
      name: 'Mine',
      steps: [
        { id: 's-low', name: 'Sonnet Low', provider: 'claude-code', model: 'sonnet', effort: 'low' },
        { id: 's-high', name: 'Sonnet High', provider: 'claude-code', model: 'sonnet', effort: 'high' },
        { id: 'o-high', name: 'Opus High', provider: 'claude-code', model: 'opus', effort: 'high' },
      ],
    },
  ],
  defaultSetId: 'mine',
  defaultStepId: 's-low',
})

describe('onboarding default model', () => {
  it('lists the provider’s default model first and only the models the person keeps listed', () => {
    expect(onboardingModels(models, 'claude-code', {}).map((entry) => entry.id)).toEqual(['sonnet', 'haiku', 'opus'])
    expect(onboardingModels(models, 'claude-code', { 'claude-code': ['opus'] }).map((entry) => entry.id)).toEqual([
      'opus',
    ])
    expect(onboardingModels(models, 'codex', {})).toEqual([])
  })

  it('offers an effort step only when the model has more than one effort, lightest first', () => {
    expect(choosableEfforts(opus)).toEqual(['low', 'medium', 'high', 'max'])
    expect(choosableEfforts(haiku)).toEqual([])
    expect(choosableEfforts(model('one', ['high']))).toEqual([])
    expect(choosableEfforts(undefined)).toEqual([])
  })

  it('keeps the effort across a model switch when the new model has it, else takes its default', () => {
    expect(withModel(opus, 'max').effort).toBe('max')
    expect(withModel(sonnet, 'max').effort).toBe('medium')
    expect(withModel(haiku, 'high').effort).toBeNull()
  })

  it('starts each provider on the saved default when it is that provider’s, else on its recommended model', () => {
    const saved = { provider: 'claude-code' as const, model: 'opus', effort: 'max' as const }
    expect(providerChoice(saved, 'claude-code', models)).toEqual(saved)
    expect(providerChoice({ ...saved, model: '' }, 'claude-code', models)).toEqual({
      provider: 'claude-code',
      model: 'sonnet',
      effort: 'medium',
    })
    const codex = model('gpt', ['low', 'high'], { provider: 'codex', isDefault: true, defaultEffort: 'low' })
    expect(providerChoice(saved, 'codex', [...models, codex])).toEqual({
      provider: 'codex',
      model: 'gpt',
      effort: 'low',
    })
    // What the person picked wins, unless that model is gone.
    const picked = { provider: 'codex' as const, model: 'gpt', effort: 'high' as const }
    expect(providerChoice(saved, 'codex', [...models, codex], picked)).toBe(picked)
    expect(providerChoice(saved, 'codex', [...models, codex], { ...picked, model: 'gone' }).model).toBe('gpt')
  })

  it('asks about each installed provider with models, the one new threads start on first', () => {
    const codex = model('gpt', ['low'], { provider: 'codex' })
    const all = [...models, codex]
    expect(activeProviders(['claude-code', 'codex', 'cursor'], all, 'codex')).toEqual(['codex', 'claude-code'])
    expect(activeProviders(['claude-code', 'codex'], all, 'cursor')).toEqual(['claude-code', 'codex'])
    expect(activeProviders([], all, 'codex')).toEqual([])
  })

  it('adds another provider’s choice as a step without moving where new threads start', () => {
    const before = preferences()
    const next = withModelStep(before, { provider: 'codex', model: 'gpt', effort: 'low' }, 'GPT Low')
    expect(next.defaultStepId).toBe('s-low')
    expect(next.sets[0]!.steps.at(-1)).toMatchObject({ provider: 'codex', model: 'gpt', name: 'GPT Low' })
    expect(withModelStep(before, { provider: 'claude-code', model: 'opus', effort: 'high' }, 'x')).toBe(before)
  })

  it('selects a matching step instead of adding one, and changes nothing when it is already the default', () => {
    const before = preferences()
    expect(withDefaultModel(before, { provider: 'claude-code', model: 'sonnet', effort: 'low' }, 'x')).toBe(before)
    const next = withDefaultModel(before, { provider: 'claude-code', model: 'opus', effort: 'high' }, 'x')
    expect(next.defaultStepId).toBe('o-high')
    expect(next.sets).toBe(before.sets)
  })

  it('adds a missing choice beside the same model’s other efforts, so the slider stays ordered', () => {
    const next = withDefaultModel(preferences(), { provider: 'claude-code', model: 'sonnet', effort: 'medium' }, 'S M')
    const steps = next.sets[0]!.steps
    expect(steps.map((step) => `${step.model}:${step.effort}`)).toEqual([
      'sonnet:low',
      'sonnet:medium',
      'sonnet:high',
      'opus:high',
    ])
    expect(next.defaultStepId).toBe(steps[1]!.id)
    const appended = withDefaultModel(preferences(), { provider: 'claude-code', model: 'haiku', effort: null }, 'H')
    expect(appended.sets[0]!.steps.at(-1)).toMatchObject({ model: 'haiku', name: 'H' })
  })

  it('keeps the automatic set following the catalog when the choice is already one of its steps', () => {
    const generated = recommendedSets([{ provider: 'claude-code', models }])
    const step = generated.sets[0]!.steps.find((entry) => entry.id !== generated.defaultStepId)!
    const next = withDefaultModel(generated, step, 'x')
    expect(next.defaultStepId).toBe(step.id)
    expect(isGeneratedModelSet(next.sets[0]!)).toBe(true)
  })

  it('saves nothing before a model is known', () => {
    const before = preferences()
    expect(withDefaultModel(before, { provider: 'codex', model: '', effort: null }, '')).toBe(before)
  })
})

describe('onboarding steps', () => {
  const kinds = (steps: ReturnType<typeof setupSteps>) => steps.map((step) => step.id)

  it('repeats the model and effort steps for each provider, skipping an effort step with nothing to choose', () => {
    const steps = setupSteps(['codex', 'claude-code'], (provider) => provider === 'codex')
    expect(kinds(steps).slice(0, 6)).toEqual([
      'agents',
      'mode',
      'model:codex',
      'effort:codex',
      'model:claude-code',
      'tokens',
    ])
    expect(kinds(setupSteps([], () => true)).slice(0, 4)).toEqual(['agents', 'mode', 'model', 'tokens'])
  })

  it('lands a step that is gone on the one after it', () => {
    const steps = setupSteps(['codex', 'claude-code'], () => false)
    expect(steps[stepIndex(steps, 'model:claude-code')]!.id).toBe('model:claude-code')
    expect(steps[stepIndex(steps, 'effort:codex')]!.id).toBe('model:claude-code')
    expect(steps[stepIndex(steps, 'effort:claude-code')]!.id).toBe('tokens')
    expect(steps[stepIndex(steps, 'model:cursor')]!.id).toBe('tokens')
    expect(stepIndex(steps, 'unknown')).toBe(0)
  })
})

describe('onboarding identities', () => {
  const drafts = identityDrafts({ gitUser: { name: 'Ada', email: 'ada@example.com' } }, 'Personal')

  it('creates nothing until the person chooses, and Personal only is prefilled from the host’s Git user', () => {
    expect(drafts.choice).toBe('none')
    expect(identitiesToAdd(drafts)).toEqual({ add: [] })
    expect(identitiesToAdd({ ...drafts, choice: 'personal' })).toEqual({
      add: [{ name: 'Personal', gitAuthor: { name: 'Ada', email: 'ada@example.com' }, rules: [] }],
    })
  })

  it('asks for an author when Personal is chosen on a host whose Git has no user', () => {
    const empty = identityDrafts({ gitUser: { name: null, email: null } }, 'Personal')
    expect(identitiesToAdd({ ...empty, choice: 'personal' })).toEqual({
      problem: { which: 'personal', field: 'author' },
    })
  })

  it('adds Work after Personal with its rule, so Personal stays the default', () => {
    const work = { ...workDraft(drafts.personal, 'Work'), email: 'ada@acme.com', rule: 'github.com/acme' }
    expect(work.author).toBe('Ada')
    const plan = identitiesToAdd({ ...drafts, choice: 'both', work })
    expect('add' in plan && plan.add.map((entry) => [entry.name, entry.rules])).toEqual([
      ['Personal', []],
      ['Work', [{ kind: 'remote', host: 'github.com', owner: 'acme' }]],
    ])
  })

  it('points at the field to fix: a bad email, an unreadable rule or a repeated name', () => {
    const work = workDraft(drafts.personal, 'Work')
    expect(identitiesToAdd({ ...drafts, choice: 'both', work })).toEqual({ problem: { which: 'work', field: 'email' } })
    // Choosing Personal only leaves a half-filled Work draft out.
    expect('add' in identitiesToAdd({ ...drafts, choice: 'personal', work })).toBe(true)
    expect(identitiesToAdd({ ...drafts, choice: 'both', work: { ...work, email: 'a@b.c', rule: 'acme' } })).toEqual({
      problem: { which: 'work', field: 'rule' },
    })
    expect(identitiesToAdd({ ...drafts, choice: 'both', work: { ...work, name: 'personal', email: 'a@b.c' } })).toEqual(
      {
        problem: { which: 'work', field: 'name' },
      },
    )
    expect(identitiesToAdd({ ...drafts, choice: 'personal', personal: { ...drafts.personal, author: '' } })).toEqual({
      problem: { which: 'personal', field: 'author' },
    })
  })
})
