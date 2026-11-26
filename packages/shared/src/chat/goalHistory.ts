import type { AgentEvent, ChatGoal, GoalCheck } from '../types'
import { goalState, isLimitHold, isUserPaused } from '@ramu/shared/chat/goalHold'

/**
 * `verify-failed` is the goal's verification command failing after a completion claim; `stalled` is the block Ramu sets
 * after continuations that changed nothing. Both are separate from `blocked` (the agent needs input), `paused` (the user
 * paused it) and a provider's usage limit (a paused goal held by the limit), which is never a row here.
 */
export type GoalChangeType =
  'set' | 'edited' | 'paused' | 'resumed' | 'blocked' | 'stalled' | 'verify-failed' | 'turn-limit' | 'cleared'
export type GoalChange = { type: GoalChangeType; goal: ChatGoal }

/**
 * The transcript line for each turning point in a goal, as English translation keys, the same on the desktop and the
 * phone. A provider's usage limit has no row here: it is "Limit reached" and never a failure of the goal.
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

/** The start of the reason Ramu gives a goal it blocks for lack of progress. */
export const STALL_REASON = 'No progress'
/** A goal Ramu blocked because continuations changed nothing, as opposed to one the agent blocked for input. */
export const isStallBlock = (goal: ChatGoal) =>
  goal.status === 'blocked' && (goal.stall?.unchanged ?? 0) >= 2 && goal.reason.startsWith(STALL_REASON)

export type CheckOutcome = { kind: 'passed' | 'timed-out' | 'unrunnable' | 'failed' } | { kind: 'exit'; code: number }

/** How a verification run ended. */
export function checkOutcome(check: GoalCheck): CheckOutcome {
  if (check.ok) return { kind: 'passed' }
  if (check.timedOut) return { kind: 'timed-out' }
  if (check.code === null) return { kind: 'unrunnable' }
  if (typeof check.code === 'number') return { kind: 'exit', code: check.code }
  return { kind: 'failed' }
}

/** The outcome in a few English words, for surfaces that do not translate through `t`. */
export function checkHow(check: GoalCheck): string {
  const outcome = checkOutcome(check)
  return outcome.kind === 'passed'
    ? 'Passed'
    : outcome.kind === 'timed-out'
      ? 'Timed out'
      : outcome.kind === 'unrunnable'
        ? 'Could not run'
        : outcome.kind === 'exit'
          ? `Exit ${outcome.code}`
          : 'Failed'
}

/** The end of a check's output: the last lines, trimmed, without the "Command exited…" line Ramu adds for the agent. */
export function checkTail(check: GoalCheck, lines = 12, chars = 1200): string {
  const body = check.output.replace(/^Command (?:timed out|could not run|exited with code \d+)\.\n?/, '').trim()
  const tail = body.split('\n').slice(-lines).join('\n')
  return tail.length > chars ? `…${tail.slice(-chars)}` : tail
}

export interface GoalFacts {
  verify?: string
  check?: { ok: boolean; command: string; how: string; outcome: CheckOutcome; tail: string }
  evidence?: { checks: { name: string; passed: boolean }[]; changedFiles: string[] }
}

/** What a goal knows beyond its objective and reason: the verification command and its latest result, and the completion evidence. */
export function goalFacts(goal: ChatGoal): GoalFacts {
  const facts: GoalFacts = {}
  if (goal.verify) facts.verify = goal.verify
  if (goal.check)
    facts.check = {
      ok: goal.check.ok,
      command: goal.check.command,
      how: checkHow(goal.check),
      outcome: checkOutcome(goal.check),
      tail: goal.check.ok ? '' : checkTail(goal.check),
    }
  if (goal.evidence)
    facts.evidence = {
      checks: goal.evidence.checks.map(({ name, passed }) => ({ name, passed })),
      changedFiles: goal.evidence.changedFiles,
    }
  return facts
}

/** The same facts as plain lines, for a surface without room for structure. */
export function goalFactLines(goal: ChatGoal): string[] {
  const { check, evidence } = goalFacts(goal)
  const lines: string[] = []
  if (check && !check.ok) lines.push(`${check.command} · ${check.how}`, ...(check.tail ? [check.tail] : []))
  else if (check) lines.push(`Verified: ${check.command}`)
  if (evidence) {
    if (evidence.checks.length)
      lines.push(`Checks: ${evidence.checks.map((c) => `${c.name} (${c.passed ? 'passed' : 'failed'})`).join(', ')}`)
    if (evidence.changedFiles.length) lines.push(`Changed: ${evidence.changedFiles.join(', ')}`)
  }
  return lines
}

/** A pause undone within this long was a slip or a brief look, not part of the thread's story. */
const BRIEF_PAUSE_MS = 2 * 60_000

/** Events that show the agent working or the person speaking, so goal changes on either side of one both stand. */
const AGENT_WORK = new Set<AgentEvent['kind']>([
  'user',
  'text',
  'thinking',
  'content',
  'tool-use',
  'error',
  'result',
  'question',
  'permission-request',
])

/**
 * The goal events worth a line in the transcript. Every status tick is recorded, but the history only needs the turning points:
 * a goal set or edited, paused, resumed, blocked, stalled, failing its verification, out of turns or cleared. Completion has its own row at the end of its turn,
 * and provider waits and turn counts belong to the live tray.
 *
 * Changes the agent did no work between read as their net effect: a pause undone within a couple of minutes leaves no
 * line, and a goal set and then edited reads as set, with its final wording. A longer pause stays, since it explains a
 * gap in the thread.
 */
export function goalChanges(events: readonly AgentEvent[]): Map<AgentEvent, GoalChange> {
  const changes = new Map<AgentEvent, GoalChange>()
  let previous: ChatGoal | null = null
  let last: { event: AgentEvent; type: GoalChangeType; at: number } | null = null
  for (const event of events) {
    if (event.kind !== 'goal') {
      if (!event.agentId && AGENT_WORK.has(event.kind)) last = null
      continue
    }
    const goal = event.goal
    const at = event.at ?? goal?.updatedAt ?? 0
    const add = (type: GoalChangeType, shown: ChatGoal) => {
      if (last?.type === 'paused' && type === 'resumed' && at - last.at <= BRIEF_PAUSE_MS) {
        changes.delete(last.event)
        last = null
        return
      }
      const merged = (last?.type === 'set' || last?.type === 'edited') && type === 'edited' ? last.type : null
      if (merged && last) changes.delete(last.event)
      changes.set(event, { type: merged ?? type, goal: shown })
      last = { event, type: merged ?? type, at }
    }
    if (!goal) {
      if (previous && previous.status !== 'completed') add('cleared', previous)
    } else if (!previous || previous.id !== goal.id) {
      if (goal.status !== 'completed') add('set', goal)
    } else if (previous.status === 'completed') {
      /* a finished goal is closed; its row is the completion */
    } else if (goal.objective !== previous.objective) add('edited', goal)
    else if (goal.check && !goal.check.ok && goal.check.at !== previous.check?.at) add('verify-failed', goal)
    else if (goalState(goal) !== goalState(previous)) {
      // A limit hold shares the paused status with a user pause, so compare the state, not the status.
      if (isUserPaused(goal)) add('paused', goal)
      else if (goal.status === 'blocked') add(isStallBlock(goal) ? 'stalled' : 'blocked', goal)
      else if (goal.status === 'turn-limit') add('turn-limit', goal)
      else if (goal.status === 'active' && !isLimitHold(previous)) add('resumed', goal)
    }
    previous = goal
  }
  return changes
}
