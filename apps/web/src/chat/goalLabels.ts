import type { ChatGoal } from '@ramu/shared/types'
import { goalState, type GoalState } from '@ramu/shared/chat/goalHold'
import type { CheckOutcome, GoalChangeType } from '@ramu/shared/chat/goalHistory'

/**
 * The goal bar's status names, as English translation keys. A provider's usage limit is "Limit reached" and a goal the
 * user paused is "Goal paused": the two read differently because one resumes by itself and the other never does.
 */
export const GOAL_LABELS: Record<GoalState, string> = {
  active: 'Working toward goal',
  completed: 'Goal completed',
  blocked: 'Goal needs input',
  paused: 'Goal paused',
  'turn-limit': 'Goal turn limit reached',
  limit: 'Limit reached',
}

/** The status name for a goal: a limit hold and a user pause share the paused status but read differently. */
export const goalLabel = (goal: Pick<ChatGoal, 'status' | 'pausedBy'>) => GOAL_LABELS[goalState(goal)]

/**
 * The transcript line for each turning point in a goal, as English translation keys. A provider's usage limit has no row
 * here: it is "Limit reached" in the bar and never a failure of the goal.
 */
export const GOAL_NOTE_LABELS: Record<GoalChangeType, string> = {
  set: 'Goal set',
  edited: 'Goal updated',
  paused: 'Goal paused',
  resumed: 'Goal resumed',
  blocked: 'Goal needs input',
  stalled: 'No progress',
  'verify-failed': 'Verification failed',
  'turn-limit': 'Goal turn limit reached',
  cleared: 'Goal cleared',
}

/** How a verification run ended, as a translation key and its values. */
export function checkOutcomeCopy(outcome: CheckOutcome): [key: string, values?: Record<string, string | number>] {
  switch (outcome.kind) {
    case 'passed':
      return ['Passed']
    case 'timed-out':
      return ['Timed out']
    case 'unrunnable':
      return ['Could not run']
    case 'exit':
      return ['Exit code {0}', { '0': outcome.code }]
    default:
      return ['Failed']
  }
}

/** The longest verification command the server accepts. */
export const VERIFY_LIMIT = 2000

/** What saving the verification field means: blank or `off` removes the command, and an unchanged value saves nothing. */
export function verifyDraft(
  draft: string,
  current: string | undefined,
): { command: string | null; changed: boolean; tooLong: boolean } {
  const text = draft.trim()
  const command = !text || /^off$/i.test(text) ? null : text
  return { command, changed: (command ?? '') !== (current ?? ''), tooLong: text.length > VERIFY_LIMIT }
}
