import type { AgentEvent, AgentProvider, ContextUsage } from '../types'

type Compaction = Extract<AgentEvent, { kind: 'compaction' }>
const tokens = (value?: number): string | null => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(Math.round(value))
}
export function compactionLabel(event: Compaction): string {
  if (event.state === 'started') return 'Compacting context…'
  if (event.state === 'failed') return 'Context compaction failed'
  if (event.state === 'cancelled') return 'Context compaction cancelled'
  if (event.state === 'unknown') return `Context compaction · ${event.providerStatus ?? 'Unknown status'}`
  const before = tokens(event.beforeTokens),
    after = tokens(event.afterTokens)
  return before && after
    ? `Compacted context ${before} → ${after} tokens`
    : before
      ? `Compacted context · ${before} tokens before`
      : after
        ? `Compacted context · ${after} tokens after`
        : 'Compacted context'
}
export function isCompacting(events: AgentEvent[]): boolean {
  const last = events.findLast(
    (event) => !event.agentId && ['compaction', 'result', 'error', 'settings'].includes(event.kind),
  )
  return last?.kind === 'compaction' && last.state === 'started'
}

/** Idle compaction must not push the preceding answer into collapsed work. */
export function isTurnFooter(event: AgentEvent): boolean {
  return event.kind === 'compaction' || (event.kind === 'result' && !event.isError)
}

/** Exact provider counts for the transcript; missing data stays visibly unknown. */
export function compactionCounts(event: Compaction): { before: string; after: string; window: string | null } {
  const count = (value?: number) =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value).toLocaleString('en-US') : null
  return {
    before: count(event.beforeTokens) ?? 'Not reported',
    after: count(event.afterTokens) ?? 'Not reported',
    window: count(event.contextWindow),
  }
}

/**
 * Context below which compacting before a message is not offered: re-reading a smaller conversation without the cache
 * costs little. Matches Claude Code's own idle-compaction threshold.
 */
const COMPACT_BEFORE_SEND_MIN_TOKENS = 200_000
/** How long Claude's prompt cache lives when no reply reported it: the subscription lifetime. */
const DEFAULT_PROMPT_CACHE_TTL_MS = 60 * 60_000

/**
 * The prompt-cache lifetime one Claude reply wrote, from its usage: 1 hour on subscriptions, 5 minutes on API keys.
 * Undefined when the reply wrote no cache entry (it was read fully from cache, or caching was off).
 */
export function promptCacheTtlMs(
  cacheCreation:
    { ephemeral_1h_input_tokens?: number | null; ephemeral_5m_input_tokens?: number | null } | null | undefined,
): number | undefined {
  if ((cacheCreation?.ephemeral_1h_input_tokens ?? 0) > 0) return 60 * 60_000
  if ((cacheCreation?.ephemeral_5m_input_tokens ?? 0) > 0) return 5 * 60_000
  return undefined
}

/**
 * When a Claude thread's prompt cache has expired, so its next message re-reads the whole conversation at full price,
 * or null when that never warrants compacting first: another provider, an unknown context, or one under 200K tokens.
 */
export function compactBeforeSendFrom(provider: AgentProvider, context: ContextUsage | null): number | null {
  if (provider !== 'claude-code' || !context) return null
  if (!Number.isFinite(context.used) || context.used < COMPACT_BEFORE_SEND_MIN_TOKENS) return null
  const at = context.lastRequestAt ?? context.at
  const expiresAt = at + (context.cacheTtlMs ?? DEFAULT_PROMPT_CACHE_TTL_MS)
  return Number.isFinite(expiresAt) ? expiresAt : null
}

/**
 * The tokens the composer offers to summarize before the next message, or null when it should not offer: only for an
 * idle Claude thread (no turn running, nothing waiting for an answer) whose large context is no longer cached.
 */
export function compactBeforeSend(input: {
  provider: AgentProvider
  idle: boolean
  context: ContextUsage | null
  now: number
}): number | null {
  if (!input.idle) return null
  const from = compactBeforeSendFrom(input.provider, input.context)
  return from !== null && input.now >= from ? input.context!.used : null
}

/** `240K`, `1.2M`: a context size short enough for a composer chip. */
export function contextTokensShort(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? value : 0
  return n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}K`
}
