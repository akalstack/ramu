// Public facts about models that their CLIs do not report: when each was released (models.dev, the catalog OpenCode
// keeps) and when a provider retires it or calls it deprecated (models.dev and LiteLLM's model list). The host reads
// both at most once a day, keeps only the few fields it uses, and works from its cached copy or without them when the
// network fails. Nothing about the person is sent; these are plain downloads of public files.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentModel, ProviderCatalog } from '@ramu/shared/types'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const REFRESH_MS = 24 * 60 * 60_000
/** A failed read waits this long before the next try, so an offline host does not retry on every catalog read. */
const RETRY_MS = 60 * 60_000
const MAX_BYTES = 32 * 1024 * 1024

/** What the host knows about one model from outside, by matching key. */
export interface ModelSignal {
  /** ISO date the model came out. */
  released?: string
  /** The provider marks it deprecated. */
  deprecated?: true
  /** ISO date the provider retires it. */
  retires?: string
}
export type ModelSignals = Record<string, ModelSignal>

/**
 * One key for the same model however a source spells it: `anthropic/claude-opus-4.8`, `claude-opus-4-8-20260101` and
 * `claude-opus-4-8[1m]` all become `claude-opus-4-8`; `gpt-5.6-sol` becomes `gpt-5-6-sol`.
 */
export function signalKey(id: string): string {
  return id
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^.*\//, '')
    .replace(/[._:]/g, '-')
    .replace(/-\d{8}$/, '')
}

const isoDate = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined

/** The model makers whose own entries win when two providers list the same model. */
const MAKERS = ['anthropic', 'openai', 'google', 'xai', 'deepseek', 'mistral', 'moonshotai', 'zai', 'alibaba']
/** LiteLLM rows from the providers' own APIs, not resellers that retire models on their own schedule. */
const DIRECT = new Set(['anthropic', 'openai', 'gemini', 'vertex_ai-language-models', 'xai', 'deepseek', 'mistral'])

/** The fields used, from models.dev's catalog: release dates and its deprecated status, makers first. */
export function fromModelsDev(data: unknown): ModelSignals {
  const providers =
    data && typeof data === 'object' ? (data as Record<string, { models?: Record<string, unknown> }>) : {}
  const order = [
    ...MAKERS.filter((id) => id in providers),
    ...Object.keys(providers).filter((id) => !MAKERS.includes(id)),
  ]
  const signals: ModelSignals = {}
  for (const provider of order) {
    for (const [id, raw] of Object.entries(providers[provider]?.models ?? {})) {
      if (!raw || typeof raw !== 'object') continue
      const model = raw as { release_date?: unknown; status?: unknown }
      const key = signalKey(id)
      if (signals[key]) continue
      const released = isoDate(model.release_date)
      signals[key] = {
        ...(released ? { released } : {}),
        ...(model.status === 'deprecated' ? { deprecated: true as const } : {}),
      }
    }
  }
  return signals
}

/** Retirement dates from LiteLLM's model list, only for rows from the model makers' own APIs. */
export function fromLiteLlm(data: unknown): ModelSignals {
  const rows = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const signals: ModelSignals = {}
  for (const [id, raw] of Object.entries(rows)) {
    if (!raw || typeof raw !== 'object' || id.includes('/')) continue
    const row = raw as { litellm_provider?: unknown; deprecation_date?: unknown }
    const retires = isoDate(row.deprecation_date)
    if (!retires || typeof row.litellm_provider !== 'string' || !DIRECT.has(row.litellm_provider)) continue
    const key = signalKey(id)
    if (!signals[key] || retires < signals[key].retires!) signals[key] = { retires }
  }
  return signals
}

export function mergeSignals(dev: ModelSignals, litellm: ModelSignals): ModelSignals {
  const merged: ModelSignals = { ...dev }
  for (const [key, signal] of Object.entries(litellm)) merged[key] = { ...merged[key], ...signal }
  return merged
}

/**
 * Adds release and retirement dates to a provider's catalog, and marks legacy what the sources call deprecated or
 * retired. A provider's own lifecycle label is never overridden, and a model the sources do not know is left to
 * Ramu's version rule, which runs after this.
 */
export function applyModelSignals(catalog: ProviderCatalog, signals: ModelSignals, now = Date.now()): ProviderCatalog {
  return {
    ...catalog,
    models: catalog.models.map((model): AgentModel => {
      const signal = signals[signalKey(model.id)]
      if (!signal) return model
      const retired = signal.retires !== undefined && Date.parse(signal.retires) <= now
      return {
        ...model,
        ...(signal.released ? { releasedAt: signal.released } : {}),
        ...(signal.retires && !retired ? { retiresAt: signal.retires } : {}),
        ...(model.isLegacy === undefined && (signal.deprecated || retired) ? { isLegacy: true } : {}),
      }
    }),
  }
}

interface Cache {
  fetchedAt: number
  signals: ModelSignals
}

/** Downloads the two sources daily and keeps the merged signals in memory and on disk. */
export class ModelSignalSource {
  private cache: Cache | null = null
  private refreshing: Promise<void> | null = null
  private failedAt = 0

  constructor(
    private readonly path: string,
    /** Off in Settings: no requests, and no signals. */
    private readonly enabled: () => boolean,
    private readonly fetcher: typeof fetch = fetch,
    private readonly changed: () => void = () => {},
  ) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Cache
      if (typeof saved.fetchedAt === 'number' && saved.signals && typeof saved.signals === 'object') this.cache = saved
    } catch {
      // Nothing saved yet.
    }
  }

  /** The signals to use now; starts a background refresh when they are stale. Never waits on the network. */
  current(now = Date.now()): ModelSignals {
    if (!this.enabled()) return {}
    if ((!this.cache || now - this.cache.fetchedAt > REFRESH_MS) && now - this.failedAt > RETRY_MS)
      void this.refresh(now)
    return this.cache?.signals ?? {}
  }

  refresh(now = Date.now()): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const [dev, litellm] = await Promise.all([this.read(MODELS_DEV_URL), this.read(LITELLM_URL)])
        this.cache = { fetchedAt: now, signals: mergeSignals(fromModelsDev(dev), fromLiteLlm(litellm)) }
        mkdirSync(dirname(this.path), { recursive: true })
        writeFileSync(`${this.path}.tmp`, JSON.stringify(this.cache), { mode: 0o600 })
        renameSync(`${this.path}.tmp`, this.path)
        this.changed()
      } catch {
        this.failedAt = now
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private async read(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_BYTES) throw new Error(`${url} is larger than Ramu reads`)
    const text = await response.text()
    if (text.length > MAX_BYTES) throw new Error(`${url} is larger than Ramu reads`)
    return JSON.parse(text) as unknown
  }
}
