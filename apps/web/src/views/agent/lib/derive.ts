import { needsChatDate } from '@ramu/shared/chat/chatDates'
import { questionState, requestOutcomes, type QuestionState } from '@ramu/shared/chat/questions'
import type { AgentEvent, ChatGoal, QueuedMessage } from '@ramu/shared/types'
import type { Turn } from '../types'
import { blockAt } from './blocks'

/** How each permission, question or elicitation request was settled, by request id. */
export const outcomesOf = requestOutcomes

/** The answer state of every question and elicitation, by request id. */
export const questionStatesOf = (events: AgentEvent[]): Map<string, QuestionState> =>
  new Map(
    events.flatMap((e) =>
      e.kind === 'question' || e.kind === 'elicitation'
        ? [[e.requestId, questionState(events, e.requestId)] as const]
        : [],
    ),
  )

/** What each question request asked, by request id, so a sent answer can show the choices it was picked from. */
export const askedQuestionsOf = (events: AgentEvent[]) =>
  new Map(events.flatMap((e) => (e.kind === 'question' ? [[e.requestId, e.questions] as const] : [])))

/** Tool results by the id of the call they answer. */
export const toolResultsOf = (events: AgentEvent[]) =>
  new Map(events.flatMap((e) => (e.kind === 'tool-result' ? [[e.toolUseId, e] as const] : [])))

/** A finished goal stays in the turn where it completed, after that turn's answer. */
export function completedGoalsByTurn(events: AgentEvent[]): Map<AgentEvent | null, ChatGoal[]> {
  const byTurn = new Map<AgentEvent | null, ChatGoal[]>(),
    seen = new Set<string>()
  let user: AgentEvent | null = null
  for (const event of events) {
    if (event.kind === 'user' && !event.agentId) user = event
    else if (event.kind === 'goal' && event.goal?.status === 'completed' && !seen.has(event.goal.id)) {
      seen.add(event.goal.id)
      byTurn.set(user, [...(byTurn.get(user) ?? []), event.goal])
    }
  }
  return byTurn
}

/** When a turn's activity ended, measured from its last step so a long-running answer counts. */
const turnEnd = (turn: Turn, at: number | undefined) =>
  turn.endedAt ?? turn.items.map(blockAt).findLast((value) => value !== undefined) ?? at

/** For each turn, the time to show as a day separator above it, or undefined when it follows closely on the last one. */
export function turnDatesOf(turns: Turn[]): (number | undefined)[] {
  let previousAt: number | undefined
  return turns.map((turn) => {
    const at = turn.startedAt ?? turn.items.map(blockAt).find((value) => value !== undefined)
    const separator = needsChatDate(at, previousAt) ? at : undefined
    previousAt = turnEnd(turn, at) ?? previousAt
    return separator
  })
}

/**
 * The day separator for a message sent at `at` that the host has not echoed yet, by the rule its turn will follow, so
 * the message does not move down when its copy arrives with a separator above it.
 */
export function nextTurnDate(turns: Turn[], at: number): number | undefined {
  let previousAt: number | undefined
  for (const turn of turns) {
    const started = turn.startedAt ?? turn.items.map(blockAt).find((value) => value !== undefined)
    previousAt = turnEnd(turn, started) ?? previousAt
  }
  return needsChatDate(at, previousAt) ? at : undefined
}

/** The day separator for the turn at `pageIndex` on the drawn page; `turnDates` covers every turn, `hiddenTurns` of which are not drawn. */
export const pageTurnDate = (turnDates: (number | undefined)[], hiddenTurns: number, pageIndex: number) =>
  turnDates[hiddenTurns + pageIndex]

/**
 * The host has a new thread's first message: as the thread's own message, or held in its queue (shown as the queued
 * opening). Until then the thread draws the copy Home sent.
 */
export const openingLanded = (events: readonly AgentEvent[], queued: readonly QueuedMessage[]) =>
  queued.length > 0 || events.some((event) => event.kind === 'user' && !event.agentId)
