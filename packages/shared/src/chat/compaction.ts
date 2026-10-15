import type { AgentEvent } from '../types'

type Compaction = Extract<AgentEvent, { kind: 'compaction' }>
const tokens = (value?: number): string | null => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(Math.round(value))
}
export function compactionLabel(event: Compaction): string {
  if (event.state === 'started') return 'Compacting context…'
  if (event.state === 'failed') return 'Context compaction failed'
  const before = tokens(event.beforeTokens),
    after = tokens(event.afterTokens)
  return before && after
    ? `Compacted context ${before} → ${after} tokens`
    : before
      ? `Compacted context · ${before} tokens before`
      : 'Compacted context'
}
export function isCompacting(events: AgentEvent[]): boolean {
  const last = events.findLast((event) => ['compaction', 'result', 'error', 'settings'].includes(event.kind))
  return last?.kind === 'compaction' && last.state === 'started'
}

/** Idle compaction must not push the preceding answer into collapsed work. */
export function isTurnFooter(event: AgentEvent): boolean {
  return event.kind === 'compaction' || (event.kind === 'result' && !event.isError)
}
