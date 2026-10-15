import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBAGENT_PREFERENCES, type AgentModel, type FallbackStep, type ProviderCatalog, type UsageReading } from '../src/types'
import { defaultOrder, isOver, nearestEffort, nextStep, peakFor, planRoute, readingCounts, resolveStep, subagentOrder, subagentTarget } from '../src/routing'

const NOW = 1_800_000_000_000
const model = (provider: AgentModel['provider'], id: string, extra: Partial<AgentModel> = {}): AgentModel => ({ provider, id, name: id, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: false, ...extra })
const catalogs: ProviderCatalog[] = [
  { provider: 'claude-code', models: [model('claude-code', 'claude-opus', { isDefault: true }), model('claude-code', 'claude-sonnet'), model('claude-code', 'claude-haiku', { efforts: [], defaultEffort: null })] },
  { provider: 'codex', models: [model('codex', 'gpt-sol', { isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh'], serviceTiers: ['fast'] })] },
  { provider: 'opencode', models: [] },
]
const reading = (r: Partial<UsageReading>): UsageReading => ({ provider: 'claude-code', window: 'five_hour', usedPercent: 50, status: 'ok', updatedAt: NOW, ...r })
const step = (provider: FallbackStep['provider'], model: string, effort: FallbackStep['effort'] = null): FallbackStep => ({ id: `${provider}-${model}`, provider, model, effort })
const claude = { provider: 'claude-code' as const, model: 'claude-opus', autoFallback: true }

describe('usage readings', () => {
  it('keep counting until their window resets, and age out without a reset time', () => {
    expect(readingCounts(reading({ resetsAt: NOW + 1000, updatedAt: NOW - 86_400_000 }), NOW)).toBe(true)
    expect(readingCounts(reading({ resetsAt: NOW - 1 }), NOW)).toBe(false)
    expect(readingCounts(reading({ updatedAt: NOW - 20 * 60_000 }), NOW)).toBe(false)
    expect(readingCounts(reading({ updatedAt: NOW - 60_000 }), NOW)).toBe(true)
  })
  it('apply a model-specific window only to that model', () => {
    const usage = [reading({ window: 'weekly', scope: 'Opus', usedPercent: 97 }), reading({ usedPercent: 20 })]
    expect(peakFor(usage, 'claude-code', 'claude-opus', NOW)?.usedPercent).toBe(97)
    expect(peakFor(usage, 'claude-code', 'claude-sonnet', NOW)?.usedPercent).toBe(20)
  })
  it('treat a limited window as over whatever the threshold', () => {
    expect(isOver(reading({ usedPercent: 40, status: 'limited' }), 95)).toBe(true)
    expect(isOver(reading({ usedPercent: 94 }), 95)).toBe(false)
    expect(isOver(reading({ usedPercent: 99 }), null)).toBe(false)
  })
})

describe('fallback steps', () => {
  it('maps an unsupported effort to the nearest supported level', () => {
    expect(nearestEffort('xhigh', model('claude-code', 'x'))).toBe('high')
    expect(nearestEffort('minimal', model('claude-code', 'x'))).toBe('low')
    expect(nearestEffort('high', model('claude-code', 'x', { efforts: [], defaultEffort: null }))).toBeNull()
    expect(nearestEffort(null, model('claude-code', 'x'))).toBe('medium')
  })
  it('fills in the default model and skips what is not installed', () => {
    expect(resolveStep(step('codex', '', 'low'), catalogs)).toMatchObject({ model: 'gpt-sol', effort: 'low', serviceTier: 'standard' })
    expect(resolveStep(step('codex', 'gone'), catalogs)).toBeNull()
    expect(resolveStep(step('opencode', ''), catalogs)).toBeNull()
  })
  it('defaults to Claude Code, then Codex, on their default models', () => {
    expect(defaultOrder(catalogs)).toMatchObject([{ provider: 'claude-code', model: 'claude-opus', effort: 'medium' }, { provider: 'codex', model: 'gpt-sol', effort: 'medium' }])
  })
  it('picks the first available entry under the threshold that was not tried', () => {
    const chain = [step('opencode', ''), step('codex', 'gpt-sol', 'high'), step('claude-code', 'claude-sonnet')]
    const usage = [reading({ provider: 'codex', usedPercent: 96, resetsAt: NOW + 5000 })]
    expect(nextStep(chain, { usage, catalogs, switchAt: 90, now: NOW })?.model).toBe('claude-sonnet')
    expect(nextStep(chain, { usage: [], catalogs, switchAt: 90, now: NOW })?.model).toBe('gpt-sol')
    expect(nextStep(chain, { usage: [], catalogs, switchAt: 90, now: NOW, attempted: new Set(['codex:gpt-sol', 'claude-code:claude-sonnet']) })).toBeNull()
  })
})

describe('planRoute', () => {
  const chain = [step('claude-code', 'claude-sonnet', 'high'), step('codex', 'gpt-sol', 'xhigh')]
  it('stays put until the provider reaches the threshold', () => {
    expect(planRoute(claude, chain, { usage: [reading({ usedPercent: 89, resetsAt: NOW + 1 })], catalogs, switchAt: 90, now: NOW })).toBeNull()
  })
  it('stays put when fallback is off for the chat', () => {
    expect(planRoute({ ...claude, autoFallback: false }, chain, { usage: [reading({ usedPercent: 99, resetsAt: NOW + 1 })], catalogs, switchAt: 90, now: NOW })).toBeNull()
  })
  it('keeps the provider but changes model when only that model window is exhausted', () => {
    const decision = planRoute(claude, chain, { usage: [reading({ window: 'weekly', scope: 'Opus', usedPercent: 98, resetsAt: NOW + 1 })], catalogs, switchAt: 90, now: NOW })
    expect(decision?.step).toMatchObject({ provider: 'claude-code', model: 'claude-sonnet', effort: 'high' })
    expect(decision?.reason).toContain('Opus weekly')
  })
  it('skips entries that are also over and never returns to the current step', () => {
    const usage = [reading({ usedPercent: 93, resetsAt: NOW + 1 }), reading({ provider: 'claude-code', window: 'weekly', usedPercent: 95, resetsAt: NOW + 1 })]
    expect(planRoute(claude, [step('claude-code', 'claude-opus'), ...chain], { usage, catalogs, switchAt: 90, now: NOW })?.step.provider).toBe('codex')
    expect(planRoute(claude, [step('claude-code', 'claude-opus')], { usage, catalogs, switchAt: 90, now: NOW })).toBeNull()
  })
  it('moves up to a higher-ranked model with room only when asked', () => {
    const order = [step('claude-code', 'claude-opus'), step('codex', 'gpt-sol'), step('claude-code', 'claude-sonnet')]
    const sonnet = { ...claude, model: 'claude-sonnet' }
    expect(planRoute(sonnet, order, { usage: [], catalogs, switchAt: 90, now: NOW })).toBeNull()
    const up = planRoute(sonnet, order, { usage: [], catalogs, switchAt: 90, now: NOW, promote: true })
    expect(up?.step.model).toBe('claude-opus')
    expect(up?.peak).toBeUndefined()
    // Opus is out, so the best with room is Codex.
    expect(planRoute(sonnet, order, { usage: [reading({ window: 'weekly', scope: 'Opus', usedPercent: 99, resetsAt: NOW + 1 })], catalogs, switchAt: 90, now: NOW, promote: true })?.step.model).toBe('gpt-sol')
  })
  it('never moves the top model, or one outside the order, up', () => {
    const order = [step('claude-code', 'claude-opus'), step('codex', 'gpt-sol')]
    expect(planRoute(claude, order, { usage: [], catalogs, switchAt: 90, now: NOW, promote: true })).toBeNull()
    expect(planRoute({ ...claude, model: 'claude-haiku' }, order, { usage: [], catalogs, switchAt: 90, now: NOW, promote: true })).toBeNull()
  })
  it('maps effort onto the target model', () => {
    const usage = [reading({ usedPercent: 99, resetsAt: NOW + 1 })]
    expect(planRoute(claude, [step('codex', 'gpt-sol', 'ultra')], { usage, catalogs, switchAt: 90, now: NOW })?.step.effort).toBe('xhigh')
  })
})

describe('sub-agent routing', () => {
  const prefs = { ...DEFAULT_SUBAGENT_PREFERENCES }
  it('is native by default and by mode', () => {
    expect(subagentTarget(prefs, 'claude-code', 'Explore')).toBeNull()
    expect(subagentTarget({ ...prefs, mode: 'single', single: step('codex', 'gpt-sol') }, 'claude-code', undefined)?.provider).toBe('codex')
    expect(subagentTarget({ ...prefs, mode: 'per-provider', perProvider: { 'claude-code': step('codex', 'gpt-sol'), codex: null } }, 'codex', undefined)).toBeNull()
  })
  it('lets a type rule win over the mode, including a native rule', () => {
    const rules = { ...prefs, mode: 'single' as const, single: step('codex', 'gpt-sol'), byType: [{ id: 'a', type: 'explore', step: step('claude-code', 'claude-haiku') }, { id: 'b', type: 'Plan', step: null }] }
    expect(subagentTarget(rules, 'claude-code', 'Explore')?.model).toBe('claude-haiku')
    expect(subagentTarget(rules, 'claude-code', 'plan')).toBeNull()
    expect(subagentTarget(rules, 'claude-code', 'other')?.provider).toBe('codex')
  })
  it('uses the separate order only when configured', () => {
    const main = [step('codex', 'gpt-sol')], own = [step('claude-code', 'claude-haiku')]
    expect(subagentOrder({ ...prefs, order: own }, main)).toBe(main)
    expect(subagentOrder({ ...prefs, fallback: 'separate', order: own }, main)).toBe(own)
    expect(subagentOrder({ ...prefs, fallback: 'separate' }, main)).toBe(main)
  })
})
