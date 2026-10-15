import type { AgentEvent, AgentQuestion } from './types'

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
  return match ? { requestId: match[1]!, body: match[2]! } : null
}

export const QUESTION_PREAMBLE = `Use Ramu's ask_user tool for clarification. Group related questions with grouping="together" when their answers must be used together; use "independent" only when each answer is independently useful. Set dependsOn to explain exactly which decision or work needs the answer. Continue independent work after asking. Before doing dependent work, use question_status to check answers and wait_for_answer if still needed; never assume an unanswered required decision. Native blocking questions and permission approvals still require an answer. Answers may arrive during work or after completion as new user messages; reassess their relevance and explain any necessary changes. When an unanswered question no longer affects the result, call close_question with a reason instead of leaving it pending. Use blocking=true only when no useful independent work remains.`
