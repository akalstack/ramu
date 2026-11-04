import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderCatalog } from '@ramu/shared/types'
import {
  LITELLM_URL,
  MODELS_DEV_URL,
  ModelSignalSource,
  applyModelSignals,
  fromLiteLlm,
  fromModelsDev,
  mergeSignals,
  signalKey,
} from '../src/providers/modelSignals'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('matches one model however a source spells it', () => {
  expect(signalKey('anthropic/claude-opus-4.8')).toBe('claude-opus-4-8')
  expect(signalKey('claude-opus-4-8-20260101')).toBe('claude-opus-4-8')
  expect(signalKey('claude-opus-4-8[1m]')).toBe('claude-opus-4-8')
  expect(signalKey('gpt-5.6-sol')).toBe('gpt-5-6-sol')
})

it('reads release dates and deprecations from models.dev, the model maker first', () => {
  const signals = fromModelsDev({
    openrouter: { models: { 'anthropic/claude-opus-4.8': { release_date: '2020-01-01' } } },
    anthropic: {
      models: {
        'claude-opus-4-8': { release_date: '2026-05-28' },
        'claude-3-opus-20240229': { release_date: '2024-02-29', status: 'deprecated' },
      },
    },
  })
  expect(signals['claude-opus-4-8']).toEqual({ released: '2026-05-28' })
  expect(signals['claude-3-opus']).toEqual({ released: '2024-02-29', deprecated: true })
})

it("takes retirement dates only from the makers' own APIs in LiteLLM's list", () => {
  const signals = fromLiteLlm({
    'claude-sonnet-4-5': { litellm_provider: 'anthropic', deprecation_date: '2026-11-30' },
    'claude-sonnet-4-5-20250929': { litellm_provider: 'anthropic', deprecation_date: '2026-12-01' },
    'claude-sonnet-4-5-v1:0': { litellm_provider: 'bedrock', deprecation_date: '2027-04-08' },
    'bedrock/claude-opus-5': { litellm_provider: 'bedrock', deprecation_date: '2027-01-01' },
    'claude-opus-5': { litellm_provider: 'anthropic', deprecation_date: null },
  })
  expect(signals).toEqual({ 'claude-sonnet-4-5': { retires: '2026-11-30' } })
})

it('adds dates to a catalog, marks deprecated or retired models legacy, and leaves the rest to the version rule', () => {
  const model = (id: string, isLegacy?: boolean) => ({
    provider: 'claude-code' as const,
    id,
    name: id,
    efforts: [],
    defaultEffort: null,
    isDefault: false,
    ...(isLegacy === undefined ? {} : { isLegacy }),
  })
  const catalog: ProviderCatalog = {
    provider: 'claude-code',
    models: [
      model('claude-opus-5'),
      model('claude-3-opus'),
      model('claude-sonnet-4-5'),
      model('claude-haiku-4'),
      model('claude-kept', false),
      model('custom'),
    ],
  }
  const signals = mergeSignals(
    {
      'claude-opus-5': { released: '2026-07-24' },
      'claude-3-opus': { deprecated: true },
      'claude-kept': { deprecated: true },
    },
    { 'claude-sonnet-4-5': { retires: '2026-11-30' }, 'claude-haiku-4': { retires: '2026-01-01' } },
  )
  const [opus5, opus3, sonnet, haiku, kept, custom] = applyModelSignals(
    catalog,
    signals,
    Date.parse('2026-11-03'),
  ).models
  expect(opus5).toMatchObject({ releasedAt: '2026-07-24' })
  expect(opus5!.isLegacy).toBeUndefined()
  expect(opus3).toMatchObject({ isLegacy: true })
  expect(sonnet).toMatchObject({ retiresAt: '2026-11-30' })
  expect(sonnet!.isLegacy).toBeUndefined()
  // Already retired: legacy, and no date ahead to mention.
  expect(haiku).toMatchObject({ isLegacy: true })
  expect(haiku!.retiresAt).toBeUndefined()
  // A provider's own label is never overridden.
  expect(kept!.isLegacy).toBe(false)
  expect(custom).toEqual(model('custom'))
})

it('downloads at most daily, keeps a copy on disk, and works from it or without signals when offline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-signals-'))
  dirs.push(dir)
  const path = join(dir, 'model-signals.json')
  let enabled = false
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === MODELS_DEV_URL
            ? { anthropic: { models: { 'claude-opus-5': { release_date: '2026-07-24' } } } }
            : url === LITELLM_URL
              ? { 'claude-sonnet-4-5': { litellm_provider: 'anthropic', deprecation_date: '2026-11-30' } }
              : {},
        ),
      ),
  ) as unknown as typeof fetch
  const source = new ModelSignalSource(path, () => enabled, fetcher)
  // Off in Settings: no requests and no signals.
  expect(source.current()).toEqual({})
  expect(fetcher).not.toHaveBeenCalled()
  enabled = true
  expect(source.current()).toEqual({})
  await source.refresh()
  expect(source.current()).toEqual({
    'claude-opus-5': { released: '2026-07-24' },
    'claude-sonnet-4-5': { retires: '2026-11-30' },
  })
  expect(existsSync(path)).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
  // A fresh copy is not downloaded again.
  source.current()
  expect(fetcher).toHaveBeenCalledTimes(2)
  // A new host start reads the saved copy; a failing network leaves it in use.
  const offline = new ModelSignalSource(path, () => true, (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch)
  await offline.refresh(Date.now() + 2 * 86_400_000)
  expect(offline.current()['claude-opus-5']).toEqual({ released: '2026-07-24' })
})

it('asks whether each list changed, keeps an unchanged one without downloading it, and keeps a source that failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-signals-'))
  dirs.push(dir)
  const asked: Record<string, string | null> = {}
  let litellmDown = false
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    asked[url] = headers.get('if-none-match')
    if (url === LITELLM_URL && litellmDown) throw new Error('offline')
    if (headers.get('if-none-match') === `"${url}"`) return new Response(null, { status: 304 })
    const body =
      url === MODELS_DEV_URL
        ? { anthropic: { models: { 'claude-opus-5': { release_date: '2026-07-24' } } } }
        : { 'claude-sonnet-4-5': { litellm_provider: 'anthropic', deprecation_date: '2026-11-30' } }
    return new Response(JSON.stringify(body), { headers: { etag: `"${url}"` } })
  }) as unknown as typeof fetch
  const source = new ModelSignalSource(join(dir, 'model-signals.json'), () => true, fetcher)
  await source.refresh(1)
  await source.refresh(2 * 86_400_000)
  // The second read named the version it had, and the unchanged answer kept the signals.
  expect(asked[MODELS_DEV_URL]).toBe(`"${MODELS_DEV_URL}"`)
  expect(source.current(2 * 86_400_000)['claude-opus-5']).toEqual({ released: '2026-07-24' })
  // One list failing keeps its last good copy beside the other.
  litellmDown = true
  await source.refresh(4 * 86_400_000)
  expect(source.current(4 * 86_400_000)['claude-sonnet-4-5']).toEqual({ retires: '2026-11-30' })
})
