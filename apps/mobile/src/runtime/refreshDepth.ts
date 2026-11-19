import type { AgentSessionState } from '@ramu/shared/types'

/**
 * How much of a host a refresh re-reads. `true` reads every held transcript (a reconnect); `false` only the lists.
 * `'live'` adds the threads that can have changed without the phone seeing it, and a set adds just those tasks.
 */
export type RefreshDepth = boolean | 'live' | ReadonlySet<string>

const WORKING: readonly (AgentSessionState | undefined)[] = ['starting', 'running', 'needs-input']

/** Whether a thread the phone already holds must read its transcript in this refresh. */
export function readsTranscript(
  depth: RefreshDepth,
  thread: {
    taskId: string
    /** The state the host reports now, and the one the phone last saw. */
    state: AgentSessionState | undefined
    knownState: AgentSessionState | undefined
    /** A sent message on this thread still waits to appear in its transcript. */
    awaitingDelivery: boolean
  },
): boolean {
  if (typeof depth === 'boolean') return depth
  if (depth !== 'live') return depth.has(thread.taskId)
  // Every other thread reaches the phone in brief, so its state events already say when it needs reading.
  return thread.awaitingDelivery || thread.state !== thread.knownState || WORKING.includes(thread.state)
}

/** Longest a transcript rebuild waits: long enough on a slow phone that rebuilding never takes most of its time. */
export const rebuildDelay = (lastBuildMs: number) => Math.min(500, Math.max(50, lastBuildMs * 4))
