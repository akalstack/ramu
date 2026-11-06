import type { AgentEvent, AgentQuestion, ThreadInputSummary, ThreadInputRequest } from '../types'
import { questionKey } from './questions'

const priority = (request: ThreadInputRequest) => (request.kind === 'approval' ? 0 : 1)

const CHOICE_MAX = 4
const CHOICE_LENGTH = 40

/** Choices a list can offer as buttons. A form of several questions, or one a person answers in the chat, opens in place. */
export function questionChoices(
  questions: AgentQuestion[],
  responseMode?: string,
): ThreadInputRequest['choices'] | undefined {
  const question = questions[0]
  if (questions.length !== 1 || !question || question.multiSelect || responseMode === 'message') return undefined
  const options = question.options.map((option) => option.label)
  if (!options.length || options.length > CHOICE_MAX || options.some((label) => label.length > CHOICE_LENGTH))
    return undefined
  return { key: questionKey(question), options }
}

/** Keep identities and origin, but never copy tool arguments, credentials or entire request forms into lists. */
export function summarizeInputs(requests: ThreadInputRequest[]): ThreadInputSummary | null {
  if (!requests.length) return null
  return {
    count: requests.length,
    approvals: requests.filter((request) => request.kind === 'approval').length,
    connectors: requests.filter((request) => request.kind === 'connector').length,
    requests: [...requests].sort((a, b) => priority(a) - priority(b)).slice(0, 3),
  }
}

/**
 * Per-kind pending counts.
 */
export function describeInputCounts(summary: ThreadInputSummary): {
  approvals: number
  questions: number
  connectors: number
} {
  const rest = Math.max(0, summary.count - summary.approvals)
  const connectors = Math.min(summary.connectors, rest)
  return { approvals: summary.approvals, questions: rest - connectors, connectors }
}

/** Merge session summaries without losing counts when their visible excerpts have already been bounded. */
export function mergeInputSummaries(summaries: (ThreadInputSummary | null | undefined)[]): ThreadInputSummary | null {
  const known = summaries.filter((summary): summary is ThreadInputSummary => !!summary)
  if (!known.length) return null
  return {
    count: known.reduce((total, summary) => total + summary.count, 0),
    approvals: known.reduce((total, summary) => total + summary.approvals, 0),
    connectors: known.reduce((total, summary) => total + summary.connectors, 0),
    requests: known
      .flatMap((summary) => summary.requests)
      .sort((a, b) => priority(a) - priority(b))
      .slice(0, 3),
  }
}

const withChoices = (questions: AgentQuestion[], responseMode?: string) => {
  const choices = questionChoices(questions, responseMode)
  return choices ? { choices } : {}
}

/** Fold the authoritative ordered event snapshot; a reused native ID starts a new request after its old resolution. */
export function inputSummary(events: AgentEvent[], sessionId: string): ThreadInputSummary | null {
  const pending = new Map<string, ThreadInputRequest>()
  for (const event of events) {
    if (event.agentId && !event.requestSource) continue
    if (event.kind === 'request-resolved') pending.delete(event.requestId)
    // The person answers a secret in the thread, never from a list, so it waits as a question with no choices.
    else if (event.kind === 'secret-request')
      pending.set(event.requestId, { sessionId, requestId: event.requestId, kind: 'question', title: event.label })
    else if (event.kind === 'permission-request' || event.kind === 'question' || event.kind === 'elicitation') {
      pending.set(event.requestId, {
        sessionId,
        requestId: event.requestId,
        kind: event.kind === 'permission-request' ? 'approval' : event.kind === 'question' ? 'question' : 'connector',
        title: (event.kind === 'permission-request'
          ? event.title || event.toolName
          : event.kind === 'question'
            ? (event.questions[0]?.question ?? '')
            : event.message
        ).slice(0, 240),
        ...(event.kind === 'elicitation' && event.serverName ? { connector: event.serverName.slice(0, 100) } : {}),
        ...(event.kind === 'question' ? withChoices(event.questions, event.responseMode) : {}),
        ...(event.requestSource
          ? { source: { ...event.requestSource, name: event.requestSource.name.slice(0, 100) } }
          : {}),
      })
    }
  }
  return summarizeInputs([...pending.values()])
}

/** List facts can change without a session-state transition (for example an async question). */
export function changesThreadSummary(event: AgentEvent): boolean {
  return [
    'state',
    'user',
    'provider-wait',
    'goal',
    'permission-request',
    'question',
    'elicitation',
    'secret-request',
    'request-resolved',
    'recovery',
  ].includes(event.kind)
}
