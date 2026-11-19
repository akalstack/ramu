import type { ChatGoal } from '@ramu/shared/types'
import { checkOutcome, checkTail, type CheckOutcome } from '@ramu/shared/chat/goalHistory'

/** The host method behind the editor. */
export const GOAL_VERIFY_METHOD = 'agent.goal.verify'
/** The longest verification command the host accepts (the desktop editor uses the same limit). */
export const VERIFY_LIMIT = 2000

/** What saving the field means: blank or `off` removes the command, and an unchanged value saves nothing. */
export function verifyDraft(
  draft: string,
  current: string | undefined,
): { command: string | null; changed: boolean; tooLong: boolean } {
  const text = draft.trim()
  const command = !text || /^off$/i.test(text) ? null : text
  return { command, changed: (command ?? '') !== (current ?? ''), tooLong: text.length > VERIFY_LIMIT }
}

/** The goal accepts a verification command until it completes; a completed goal is read-only and the host refuses. */
export const canEditVerify = (goal: ChatGoal | null | undefined): goal is ChatGoal =>
  !!goal && goal.status !== 'completed'

export interface VerifyView {
  /** The command now set, if any. */
  command?: string
  /** The latest run of it. A failure carries the end of its output. */
  check?: { ok: boolean; command: string; outcome: CheckOutcome; tail: string }
}

/** What the editor shows above its field: the current command and how its last run ended. */
export function verifyView(goal: ChatGoal): VerifyView {
  const view: VerifyView = {}
  if (goal.verify) view.command = goal.verify
  if (goal.check)
    view.check = {
      ok: goal.check.ok,
      command: goal.check.command,
      outcome: checkOutcome(goal.check),
      tail: goal.check.ok ? '' : checkTail(goal.check),
    }
  return view
}

/** The i18n key for how a run ended, with the exit code to fill in for `verifyExit`. */
export function outcomeKey(outcome: CheckOutcome): {
  key: 'verifyPassed' | 'verifyTimedOut' | 'verifyUnrunnable' | 'verifyExit' | 'verifyFailedPlain'
  code?: number
} {
  switch (outcome.kind) {
    case 'passed':
      return { key: 'verifyPassed' }
    case 'timed-out':
      return { key: 'verifyTimedOut' }
    case 'unrunnable':
      return { key: 'verifyUnrunnable' }
    case 'exit':
      return { key: 'verifyExit', code: outcome.code }
    default:
      return { key: 'verifyFailedPlain' }
  }
}
