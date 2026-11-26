import type { ChatGoal } from '../types/goal'
import type { Task, TitleSource } from '../types/workspace'
import { goalHold } from './goalHold'

/** What a thread list shows for one thread. `short` and `full` are catalog keys, translated where they are shown. */
export interface ThreadStatus {
  kind:
    | 'working'
    | 'goal'
    | 'verifying'
    | 'approval'
    | 'input'
    | 'limit'
    | 'failed'
    | 'stopped'
    | 'paused'
    | 'blocked'
    | 'turn-limit'
    | 'finished'
  short: string
  full: string
  /** What lets the thread continue, when that is up to the person; a catalog key like the others. */
  next?: string
}

/** The part of a goal that decides a status; a `ChatGoal` and a list summary both fit. */
type GoalLike = Pick<ChatGoal, 'status' | 'pausedBy'> & { verifying?: boolean }

/**
 * The one status a thread row, its popover and its accessible name agree on. The priority is the sidebar's: live
 * input (approvals first), live work, a provider hold, a failure, then what an unfinished goal needs, and last a
 * finished result not yet viewed. An active goal is unfinished between turns and while verification runs, so it never
 * reads as finished. A goal paused by the user, blocked, or at its turn limit stays distinct from a provider limit.
 * Null means nothing needs saying and the row shows its age. A host that is not connected shows last-known state, so
 * callers qualify it rather than hiding it.
 */
export function threadStatus(
  task: Pick<Task, 'status' | 'waitingUntil' | 'inputSummary' | 'executionState' | 'helperSummary'>,
  unread: boolean,
  goal?: GoalLike | null,
): ThreadStatus | null {
  const unfinished = goal && goal.status !== 'completed' ? goal : null
  const limit: ThreadStatus = { kind: 'limit', short: 'Limit reached', full: 'Limit reached' }
  if (task.inputSummary?.count)
    return task.inputSummary.approvals
      ? {
          kind: 'approval',
          short: 'Approval',
          full: 'Approval needed',
          next: 'Allow or deny to let the agent continue.',
        }
      : {
          kind: 'input',
          short: 'Needs input',
          full: 'Waiting for your input',
          next: 'Answer to let the agent continue.',
        }
  // Independent helper work keeps the thread working after its parent goes idle, even before the stored status catches up.
  if (task.status === 'running' || (task.helperSummary?.active && task.status !== 'needs-input')) {
    if (goalHold(unfinished) === 'provider-limit') return limit
    if (unfinished?.status === 'active' && unfinished.verifying)
      return { kind: 'verifying', short: 'Verifying', full: 'Verifying goal' }
    return unfinished?.status === 'active'
      ? { kind: 'goal', short: 'Goal', full: 'Working toward goal' }
      : { kind: 'working', short: 'Working', full: 'Agent working' }
  }
  if (task.status === 'needs-input')
    return {
      kind: 'input',
      short: 'Needs input',
      full: 'Waiting for your input',
      next: 'Answer to let the agent continue.',
    }
  if (task.waitingUntil || goalHold(unfinished) === 'provider-limit') return limit
  if (task.status === 'failed')
    return { kind: 'failed', short: 'Failed', full: 'Agent failed', next: 'Retry, or send a message to continue.' }
  if (unfinished?.status === 'active' && unfinished.verifying)
    return { kind: 'verifying', short: 'Verifying', full: 'Verifying goal' }
  if (unfinished?.status === 'active') return { kind: 'goal', short: 'Goal', full: 'Working toward goal' }
  if (unfinished?.status === 'paused')
    return { kind: 'paused', short: 'Paused', full: 'Goal paused', next: 'Resume the goal to continue.' }
  if (unfinished?.status === 'blocked')
    return {
      kind: 'blocked',
      short: 'Needs input',
      full: 'Goal needs input',
      next: 'Reply with what the goal needs, then resume it.',
    }
  if (unfinished?.status === 'turn-limit')
    return {
      kind: 'turn-limit',
      short: 'Turn limit',
      full: 'Goal turn limit reached',
      next: 'Resume the goal to give it more turns.',
    }
  if (task.executionState === 'stopped')
    return {
      kind: 'stopped',
      short: 'Stopped',
      full: 'Agent stopped',
      next: 'Send a message to continue where it stopped.',
    }
  if (unread) return { kind: 'finished', short: 'Finished', full: 'Finished, not viewed yet' }
  return null
}

/**
 * How much a status asks of the person, for marks that carry a tinted background (the Inbox's round marks): amber while
 * it waits on them or on a usage limit, red when it failed, quiet otherwise. The same scale as the sidebar's dots.
 */
export function statusTone(status: ThreadStatus): 'warn' | 'bad' | 'neutral' {
  if (status.kind === 'failed') return 'bad'
  if (
    status.kind === 'approval' ||
    status.kind === 'input' ||
    status.kind === 'blocked' ||
    status.kind === 'turn-limit' ||
    status.kind === 'limit'
  )
    return 'warn'
  return 'neutral'
}

/**
 * The newer of two reads of the same task from one host. A read without a `snapshotAt` always replaces,
 * since nothing can order it; a late, older read never brings back work that has since stopped or finished.
 */
export function newerTaskSnapshot<T extends Pick<Task, 'snapshotAt'>>(current: T | undefined, incoming: T): T {
  if (!current || current.snapshotAt === undefined || incoming.snapshotAt === undefined) return incoming
  return incoming.snapshotAt >= current.snapshotAt ? incoming : current
}

/** Where a thread's title came from and whether Ramu may still change it, as English copy for `t()`. */
export function titleSourceNote(source: TitleSource | undefined): string | null {
  switch (source) {
    case 'manual':
      return 'Named by you. Ramu will not rename it.'
    case 'ai':
      return 'Named by Ramu. Rename it to keep your own title.'
    case 'provider':
      return 'Named by the provider. Rename it to keep your own title.'
    case 'prompt':
      return 'From your first message. Ramu may name it once the thread has more to go on.'
    default:
      return null
  }
}
