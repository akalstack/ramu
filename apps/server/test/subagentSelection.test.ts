import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, DEFAULT_AGENT_SETTINGS, type ProviderCatalog } from '@ramu/shared/types'
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
const answer = (message: string) => vi.fn(async () => ({ message, provider: 'codex' as const, model: 'small' }))
const parse = (subagents: unknown) => appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, subagents }).subagents

describe('saved sub-agent preferences', () => {
  it("defaults to the thread's model and validates the choice", () => {
    expect(parse({})).toEqual({ model: 'thread', step: null, codexHook: false })
    expect(() => parse({ model: 'cheapest' })).toThrow()
  })

  it('keeps a model picked under the old settings and drops the rest', () => {
    const step = { id: 's', provider: 'codex', model: 'large', effort: null }
    expect(parse({ mode: 'single', single: step, maxEffort: 'low', codexHook: true })).toEqual({
      model: 'pick',
      step,
      codexHook: true,
    })
    expect(parse({ mode: 'per-provider', perProvider: { codex: step }, autoSelect: 'model-and-effort' })).toEqual({
      model: 'thread',
      step: null,
      codexHook: false,
    })
  })
})

describe('a model chosen for each task', () => {
  it('asks the destination provider with fallback disabled and takes its choice', async () => {
    const analyze = answer('{"model":"large","effort":"low"}')
    const result = await selectSubagentSettings(settings, catalogs, 'Review this', analyze)
    expect(result.settings).toMatchObject({ provider: 'codex', model: 'large', effort: 'low', serviceTier: 'standard' })
    expect(analyze.mock.calls[0]).toEqual([
      expect.stringContaining('Review this'),
      expect.objectContaining({ provider: 'codex', autoFallback: false, autoResume: false }),
      2000,
      expect.objectContaining({ timeoutMs: 30000 }),
    ])
  })

  it("keeps the thread's fast tier when it keeps the thread's model", async () => {
    const result = await selectSubagentSettings(
      { ...settings, serviceTier: 'fast' },
      catalogs,
      'Task',
      answer('{"model":"small","effort":"low"}'),
    )
    expect(result.settings).toMatchObject({ model: 'small', effort: 'low', serviceTier: 'fast' })
  })

  it.each(['bad JSON', '{"model":"missing","effort":"low"}', '{"model":"small","effort":null}'])(
    "keeps the thread's settings for an invalid choice: %s",
    async (message) => {
      const result = await selectSubagentSettings(settings, catalogs, 'Task', answer(message))
      expect(result.settings).toEqual(settings)
      expect(result.note).toContain('unavailable')
    },
  )

  it('recovers from provider failure but propagates cancellation', async () => {
    const analyze = vi.fn(async () => {
      throw new Error('Unavailable')
    })
    expect((await selectSubagentSettings(settings, catalogs, 'Task', analyze)).settings).toEqual(settings)
    const abort = new AbortController()
    abort.abort()
    await expect(selectSubagentSettings(settings, catalogs, 'Task', analyze, abort.signal)).rejects.toThrow()
  })
})
