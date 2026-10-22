import type { ChatGoal } from '../types/goal'
import type { Task } from '../types/workspace'
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
  task: Pick<Task, 'status' | 'waitingUntil' | 'inputSummary' | 'executionState'>,
  unread: boolean,
  goal?: GoalLike | null,
): ThreadStatus | null {
  const unfinished = goal && goal.status !== 'completed' ? goal : null
  const limit: ThreadStatus = { kind: 'limit', short: 'Limit reached', full: 'Limit reached' }
  if (task.inputSummary?.count)
    return task.inputSummary.approvals
      ? { kind: 'approval', short: 'Approval', full: 'Approval needed' }
      : { kind: 'input', short: 'Needs input', full: 'Waiting for your input' }
  if (task.status === 'running') {
    if (goalHold(unfinished) === 'provider-limit') return limit
    if (unfinished?.status === 'active' && unfinished.verifying)
      return { kind: 'verifying', short: 'Verifying', full: 'Verifying goal' }
    return unfinished?.status === 'active'
      ? { kind: 'goal', short: 'Goal', full: 'Working toward goal' }
      : { kind: 'working', short: 'Working', full: 'Agent working' }
  }
  if (task.status === 'needs-input') return { kind: 'input', short: 'Needs input', full: 'Waiting for your input' }
  if (task.waitingUntil || goalHold(unfinished) === 'provider-limit') return limit
  if (task.status === 'failed') return { kind: 'failed', short: 'Failed', full: 'Agent failed' }
  if (unfinished?.status === 'active' && unfinished.verifying)
    return { kind: 'verifying', short: 'Verifying', full: 'Verifying goal' }
  if (unfinished?.status === 'active') return { kind: 'goal', short: 'Goal', full: 'Working toward goal' }
  if (unfinished?.status === 'paused') return { kind: 'paused', short: 'Paused', full: 'Goal paused' }
  if (unfinished?.status === 'blocked') return { kind: 'blocked', short: 'Needs input', full: 'Goal needs input' }
  if (unfinished?.status === 'turn-limit')
    return { kind: 'turn-limit', short: 'Turn limit', full: 'Goal turn limit reached' }
  if (task.executionState === 'stopped') return { kind: 'stopped', short: 'Stopped', full: 'Agent stopped' }
  if (unread) return { kind: 'finished', short: 'Finished', full: 'Finished, not viewed yet' }
  return null
}
