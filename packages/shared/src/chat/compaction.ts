import type { AgentEvent } from '../types'

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
