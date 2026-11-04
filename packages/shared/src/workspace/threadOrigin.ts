import type { Task, ThreadOrigin } from '../types'
import { continuedFrom } from '../continuation'

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

type Translate = (text: string, values?: Record<string, string>) => string

/** Who started a thread the person did not start themselves, in the words both the sidebar and the phone's list use. */
export function threadOriginLabel(origin: ThreadOrigin, t: Translate): string {
  if (startedFromTerminal(origin)) return t('Started from a terminal by {0}', { '0': origin.host ?? '' })
  if (continuedFrom(origin) && origin.host)
    return t('Continued from {0} on {1}', { '0': origin.title ?? '', '1': origin.host })
  if (origin.host) return t('Started by an agent on {0}', { '0': origin.host })
  if (origin.title) return t('Started by the agent in {0}', { '0': origin.title })
  return t('Started by another thread')
}
