import type { AgentEvent } from '@ramu/shared/types'

/** What `agent.changes` answers: the changed rows, or a full snapshot when `reset` is set. */
export interface TranscriptChanges {
  reset: boolean
  cursor: number
  events: { seq: number; event: AgentEvent }[]
}

/**
 * The rows a chat holds after a read: a reset replaces them, otherwise the changed rows are applied over what is held
 * (new rows are added and edited rows replaced in place). Returns a new map and leaves `held` untouched.
 */
export function mergeTranscript(
  held: ReadonlyMap<number, AgentEvent> | undefined,
  result: TranscriptChanges,
): Map<number, AgentEvent> {
  const rows = result.reset || !held ? new Map<number, AgentEvent>() : new Map(held)
  for (const { seq, event } of result.events) rows.set(seq, event)
  return rows
}

/** The held rows as the snapshot shape the transcript builder takes, in sequence order. */
export function transcriptRows(rows: ReadonlyMap<number, AgentEvent>): { seq: number; event: AgentEvent }[] {
  return [...rows].sort(([a], [b]) => a - b).map(([seq, event]) => ({ seq, event }))
}
