import type { AgentEvent, AgentQuestion } from '../types'
import { visibleMessage } from '@ramu/shared/chat/visibleMessage'

export type QuestionRequest = Extract<AgentEvent, { kind: 'question' }>
export interface QuestionInput {
  questions: AgentQuestion[]
  grouping?: 'together' | 'independent'
  dependsOn?: string
  blocking?: boolean
}
export interface QuestionState {
  answers: Record<string, string>
  drafts: Record<string, string>
  waiting: boolean
  outcome?: string
  reason?: string
}
export const questionKey = (question: AgentQuestion): string => question.id ?? question.question
export const questionAnswer = (answers: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(answers, key) ? answers[key] : undefined

/** Native providers may reuse a permission id after restarting their process. */
export function requestOutcomes(events: AgentEvent[]): Map<string, string> {
  const outcomes = new Map<string, string>()
  for (const event of events) {
    if (event.kind === 'permission-request') outcomes.delete(event.requestId)
    else if (event.kind === 'request-resolved') outcomes.set(event.requestId, event.outcome)
  }
  return outcomes
}

export function questionState(events: AgentEvent[], requestId: string): QuestionState {
  const state: QuestionState = { answers: Object.create(null), drafts: Object.create(null), waiting: false }
  for (const event of events) {
    if (event.kind === 'question-state' && event.requestId === requestId) {
      Object.assign(state.answers, event.answers)
      if (event.drafts) state.drafts = event.drafts
      if (event.waiting !== undefined) state.waiting = event.waiting
      if (event.reason) state.reason = event.reason
    } else if (event.kind === 'request-resolved' && event.requestId === requestId) {
      state.outcome = event.outcome
      state.waiting = false
    }
  }
  return state
}

// Late answers reach the agent as a message; the chat shows only the answers, not the delivery note.
const ANSWERS = /^Answer to your earlier questions? \(request ([\w-]+)\)\. [^\n]*\n\n([\s\S]*)$/
export function answerMessage(requestId: string, answers: { question: string; answer: string }[]): string {
  return `Answer to your earlier question${answers.length > 1 ? 's' : ''} (request ${requestId}). Apply these answers if still relevant; if work is already complete, explain any changes needed.\n\n${answers.map((entry) => `${entry.question}\n${entry.answer}`).join('\n\n')}`
}
export function parseAnswerMessage(text: string): { requestId: string; body: string } | null {
  const match = ANSWERS.exec(text)
  // The context Ramu appends for the agent is not part of what the person answered.
  return match ? { requestId: match[1]!, body: visibleMessage(match[2]!) } : null
}

/**
 * A late answer's body as question and answer pairs, so the chat can set what was asked apart from what the person
 * said. A paragraph of one line continues the answer before it, as a typed answer of several paragraphs does.
 */
export function answerPairs(body: string): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = []
  for (const block of body.split(/\n{2,}/)) {
    const at = block.indexOf('\n')
    const last = pairs.at(-1)
    if (at < 0 && last) last.answer = `${last.answer}\n\n${block}`
    else if (at < 0) pairs.push({ question: '', answer: block })
    else pairs.push({ question: block.slice(0, at), answer: block.slice(at + 1) })
  }
  return pairs
}

/**
 * A sent answer against the choices its question offered, so the chat can show what was on offer with the picked ones
 * marked. `typed` is whatever the answer says beyond the choices (the person's own words). Null for a question that
 * offered no choices.
 */
export function answerChoices(
  question: Pick<AgentQuestion, 'options' | 'multiSelect'> | undefined,
  answer: string,
): { options: { label: string; chosen: boolean }[]; typed: string } | null {
  if (!question?.options.length) return null
  const labels = question.options.map((option) => option.label)
  // Several picks are sent joined by commas, in the order offered; a label may hold a comma itself.
  const picked = new Set(
    labels.includes(answer)
      ? [answer]
      : question.multiSelect
        ? labels.filter((label) => `, ${answer}, `.includes(`, ${label}, `))
        : [],
  )
  const joined = labels.filter((label) => picked.has(label)).join(', ')
  return {
    options: labels.map((label) => ({ label, chosen: picked.has(label) })),
    typed: joined === answer ? '' : picked.size ? answer.replace(joined, '').replace(/^, |, $/g, '') : answer,
  }
}

export const QUESTION_INPUT_GUIDANCE =
  'For an open-ended question that needs the user’s own words, omit options or pass options=[]; the user must type and submit an explicit non-empty answer. Do not invent choices or a default answer for these questions.'

export const QUESTION_PREAMBLE = `Use Ramu's ask_user tool for clarification. ${QUESTION_INPUT_GUIDANCE} Group related questions with grouping="together" when their answers must be used together; use "independent" only when each answer is independently useful. Set dependsOn to explain exactly which decision or work needs the answer. Continue independent work after asking. Before doing dependent work, use question_status to check answers and wait_for_answer if still needed; never assume an unanswered required decision. Native blocking questions and permission approvals still require an answer. Answers may arrive during work or after completion as new user messages; reassess their relevance and explain any necessary changes. When an unanswered question no longer affects the result, call close_question with a reason instead of leaving it pending. Use blocking=true only when no useful independent work remains.`
