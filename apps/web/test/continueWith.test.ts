import { expect, it } from 'vitest'
import type { AgentModel, AgentSettings, FallbackStep, ProviderCatalog, UsageReading } from '@ramu/shared/types'
import { continueOptions, settingsOnStep } from '../src/models/continueWith'

const NOW = Date.parse('2026-10-18T12:00:00Z')
const model = (provider: ProviderCatalog['provider'], id: string, isDefault = true): AgentModel => ({
  provider,
  id,
  name: id,
  efforts: ['low', 'high'],
  defaultEffort: 'low' as const,
  isDefault,
})
const catalogs: ProviderCatalog[] = [
  { provider: 'claude-code', models: [model('claude-code', 'sonnet'), model('claude-code', 'opus', false)] },
  { provider: 'codex', models: [model('codex', 'gpt-x')] },
  { provider: 'opencode', models: [model('opencode', 'oc')] },
]
const limited = (provider: UsageReading['provider'], extra: Partial<UsageReading> = {}): UsageReading => ({
  provider,
  window: 'five_hour',
  usedPercent: 100,
  status: 'limited',
  updatedAt: NOW,
  resetsAt: NOW + 3_600_000,
  ...extra,
})
const options = (current: AgentSettings['provider'], usage: UsageReading[], order: FallbackStep[] = []) =>
  continueOptions({ settings: { provider: current }, order, catalogs, usage, now: NOW }).map(
    (step) => `${step.provider}:${step.model}`,
  )

it('offers every other provider on its default model', () => {
  expect(options('claude-code', [])).toEqual(['codex:gpt-x', 'opencode:oc'])
})

it('leaves out a provider that is known to be limited, and says nothing about one with no reading', () => {
  expect(options('claude-code', [limited('codex')])).toEqual(['opencode:oc'])
})

it('is empty when every other provider is limited, so the menu offers nothing', () => {
  expect(options('claude-code', [limited('codex'), limited('opencode')])).toEqual([])
  expect(options('claude-code', [limited('claude-code')])).toEqual(['codex:gpt-x', 'opencode:oc'])
})

it('ignores a limit whose window has already reset', () => {
  expect(options('claude-code', [limited('codex', { resetsAt: NOW - 1 })])).toEqual(['codex:gpt-x', 'opencode:oc'])
})

it('takes the model from the fallback order where it names the provider', () => {
  const order: FallbackStep[] = [
    { id: 'a', provider: 'codex', model: 'gpt-x', effort: 'high' },
    { id: 'b', provider: 'claude-code', model: 'opus', effort: null },
  ]
  const steps = continueOptions({ settings: { provider: 'codex' }, order, catalogs, usage: [], now: NOW })
  expect(steps.map((step) => `${step.provider}:${step.model}`)).toEqual(['claude-code:opus', 'opencode:oc'])
})

it('skips a provider whose model list could not be read', () => {
  const broken: ProviderCatalog[] = [...catalogs, { provider: 'cursor', models: [model('cursor', 'c')], error: 'x' }]
  const steps = continueOptions({ settings: { provider: 'codex' }, order: [], catalogs: broken, usage: [], now: NOW })
  expect(steps.some((step) => step.provider === 'cursor')).toBe(false)
})

it('moves a thread onto the step and keeps everything else, including its own auto-resume', () => {
  const settings: AgentSettings = {
    provider: 'codex',
    accountId: 'work',
    model: 'gpt-x',
    effort: 'high',
    serviceTier: 'fast',
    access: 'edits',
    autoFallback: false,
    autoResume: false,
  }
  expect(settingsOnStep(settings, { id: 's', provider: 'opencode', model: 'oc', effort: 'low' })).toEqual({
    provider: 'opencode',
    model: 'oc',
    effort: 'low',
    access: 'edits',
    autoFallback: false,
    autoResume: false,
  })
})
