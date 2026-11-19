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

/** Streaming content is published with the transcript batch; only control state needs an immediate store update. */
export function updateThreadMetadata(chat: import('./types').Chat, event: AgentEvent): import('./types').Chat {
  if (event.kind === 'state')
    return {
      ...chat,
      executionState: event.state,
      activityLabel:
        event.state === 'starting'
          ? 'Starting…'
          : event.state === 'running'
            ? chat.activityLabel === 'Starting…'
              ? 'Working'
              : (chat.activityLabel ?? 'Working')
            : null,
      status:
        event.state === 'running' || event.state === 'starting'
          ? 'running'
          : event.state === 'needs-input'
            ? 'needs-input'
            : event.state === 'failed'
              ? 'failed'
              : ['running', 'needs-input', 'ready-for-review'].includes(chat.status)
                ? 'ready-for-review'
                : 'idle',
    }
  if (event.kind === 'queue')
    return { ...chat, queue: event.messages, queuePaused: !!event.paused, queueWaitingFor: event.waitingFor }
  if (event.kind === 'goal') return { ...chat, goal: event.goal }
  if (event.kind === 'settings')
    return {
      ...chat,
      provider: event.settings.provider,
      model: event.settings.model,
      effort: event.settings.effort ?? '',
      settings: event.settings,
    }
  return chat
}

/** Commit a transcript and its cursor together only after its companion reads succeed on the same connection. */
export async function readTranscriptBundle<T, B, G>(
  reads: [Promise<T>, Promise<B>, Promise<G>],
  current: () => boolean,
  commit: (snapshot: T) => void,
): Promise<[T, B, G] | null> {
  const bundle = await Promise.all(reads)
  if (!current()) return null
  commit(bundle[0])
  return bundle
}
