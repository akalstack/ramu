import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_SUBAGENT_PREFERENCES,
  type ProviderCatalog,
} from '@ramu/shared/types'
import { selectSubagentSettings } from '../src/agent/subagentSelection'
import { appPreferences } from '../src/ipc/preferences'

const catalogs: ProviderCatalog[] = [
  {
    provider: 'codex',
    models: ['small', 'large'].map((id) => ({
      provider: 'codex',
      id,
      name: id,
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      isDefault: id === 'small',
    })),
  },
]
const settings = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' as const, model: 'small', effort: 'high' as const }
const prefs = { ...DEFAULT_SUBAGENT_PREFERENCES, autoSelect: 'model-and-effort' as const, maxEffort: 'medium' as const }
const answer = (message: string) => vi.fn(async () => ({ message, provider: 'codex' as const, model: 'small' }))

describe('sub-agent selection', () => {
  it('preserves existing installations and validates saved settings', () => {
    expect(appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, subagents: {} }).subagents).toMatchObject({
      autoSelect: 'off',
      maxEffort: null,
      modelMaxEffort: {},
    })
    expect(appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, subagents: prefs }).subagents).toMatchObject(prefs)
    expect(() => appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, subagents: { maxEffort: 'invalid' } })).toThrow()
  })

  it('asks the destination provider with fallback disabled and enforces model caps', async () => {
    const analyze = answer('{"model":"large","effort":"low"}')
    const result = await selectSubagentSettings(
      settings,
      { ...prefs, modelMaxEffort: { 'codex:large': 'low' } },
      catalogs,
      'Review this',
      analyze,
    )
    expect(result.settings).toMatchObject({ provider: 'codex', model: 'large', effort: 'low' })
    expect(analyze.mock.calls[0]).toEqual([
      expect.stringContaining('Review this'),
      expect.objectContaining({ provider: 'codex', autoFallback: false, autoResume: false, effort: 'medium' }),
      2000,
      expect.objectContaining({ timeoutMs: 30000 }),
    ])
  })

  it('effort-only selection preserves the configured service tier', async () => {
    const result = await selectSubagentSettings(
      { ...settings, serviceTier: 'fast' },
      { ...prefs, autoSelect: 'effort-only' },
      catalogs,
      'Task',
      answer('{"model":"small","effort":"low"}'),
    )
    expect(result.settings).toMatchObject({ model: 'small', effort: 'low', serviceTier: 'fast' })
  })

  it('effort-only selection retains the configured model', async () => {
    const result = await selectSubagentSettings(
      settings,
      { ...prefs, autoSelect: 'effort-only' },
      catalogs,
      'Task',
      answer('{"model":"large","effort":"low"}'),
    )
    expect(result.settings).toMatchObject({ model: 'small', effort: 'medium' })
    expect(result.note).toContain('unavailable')
  })

  it.each([
    'bad JSON',
    '{"model":"missing","effort":"low"}',
    '{"model":"large","effort":"high"}',
    '{"model":"small","effort":null}',
  ])('uses capped configured settings for invalid selection: %s', async (message) => {
    const result = await selectSubagentSettings(settings, prefs, catalogs, 'Task', answer(message))
    expect(result.settings).toMatchObject({ model: 'small', effort: 'medium' })
  })

  it('recovers from provider failure but propagates cancellation', async () => {
    const analyze = vi.fn(async () => {
      throw new Error('Unavailable')
    })
    expect((await selectSubagentSettings(settings, prefs, catalogs, 'Task', analyze)).settings.effort).toBe('medium')
    const abort = new AbortController()
    abort.abort()
    await expect(selectSubagentSettings(settings, prefs, catalogs, 'Task', analyze, abort.signal)).rejects.toThrow()
  })
})
