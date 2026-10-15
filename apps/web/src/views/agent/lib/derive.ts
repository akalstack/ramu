import { needsChatDate } from '@ramu/shared/chatDates'
import { questionState, type QuestionState } from '@ramu/shared/questions'
import type { AgentEvent, ChatGoal } from '@ramu/shared/types'
import type { Turn } from '../types'
import { blockAt } from './blocks'

/** How each permission, question or elicitation request was settled, by request id. */
export const outcomesOf = (events: AgentEvent[]) =>
  new Map(events.flatMap((e) => (e.kind === 'request-resolved' ? [[e.requestId, e.outcome] as const] : [])))

/** The answer state of every question and elicitation, by request id. */
export const questionStatesOf = (events: AgentEvent[]): Map<string, QuestionState> =>
  new Map(
    events.flatMap((e) =>
      e.kind === 'question' || e.kind === 'elicitation'
        ? [[e.requestId, questionState(events, e.requestId)] as const]
        : [],
    ),
  )

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

/** For each turn, the time to show as a day separator above it, or undefined when it follows closely on the last one. */
export function turnDatesOf(turns: Turn[]): (number | undefined)[] {
  let previousAt: number | undefined
  return turns.map((turn) => {
    const at = turn.startedAt ?? turn.items.map(blockAt).find((value) => value !== undefined)
    const separator = needsChatDate(at, previousAt) ? at : undefined
    // Measure the pause from the last activity, including a long-running answer.
    previousAt = turn.endedAt ?? turn.items.map(blockAt).findLast((value) => value !== undefined) ?? at ?? previousAt
    return separator
  })
}

/** The day separator for the turn at `pageIndex` on the drawn page; `turnDates` covers every turn, `hiddenTurns` of which are not drawn. */
export const pageTurnDate = (turnDates: (number | undefined)[], hiddenTurns: number, pageIndex: number) =>
  turnDates[hiddenTurns + pageIndex]
