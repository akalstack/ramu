import type { Task, ThreadOrigin } from '../types'

export type ThreadState = 'running' | 'waiting' | 'failed' | 'finished' | 'stopped'

/** Where a thread is, in the words the person reads: waiting on them first, then working, then how it ended. */
export function threadState(task: Task): ThreadState {
  if (task.inputSummary || task.executionState === 'needs-input') return 'waiting'
  if (task.executionState === 'running' || task.executionState === 'starting') return 'running'
  if (task.executionState === 'failed') return 'failed'
  if (task.executionState === 'stopped') return 'stopped'
  return 'finished'
}

/** A thread `ramu thread start` placed here; its origin names whoever ran it. */
export const startedFromTerminal = (origin: Pick<ThreadOrigin, 'groupId'> | null | undefined) =>
  !!origin?.groupId.startsWith('terminal:')
