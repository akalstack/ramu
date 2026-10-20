import type { AgentEvent, ThreadInputSummary, ThreadInputRequest } from '../types'

const priority = (request: ThreadInputRequest) => (request.kind === 'approval' ? 0 : 1)

/** Keep identities and origin, but never copy tool arguments, credentials or entire request forms into lists. */
export function summarizeInputs(requests: ThreadInputRequest[]): ThreadInputSummary | null {
  if (!requests.length) return null
  return {
    count: requests.length,
    approvals: requests.filter((request) => request.kind === 'approval').length,
    requests: [...requests].sort((a, b) => priority(a) - priority(b)).slice(0, 3),
  }
}

/** Merge session summaries without losing counts when their visible excerpts have already been bounded. */
export function mergeInputSummaries(summaries: (ThreadInputSummary | null | undefined)[]): ThreadInputSummary | null {
  const known = summaries.filter((summary): summary is ThreadInputSummary => !!summary)
  if (!known.length) return null
  return {
    count: known.reduce((total, summary) => total + summary.count, 0),
    approvals: known.reduce((total, summary) => total + summary.approvals, 0),
    requests: known
      .flatMap((summary) => summary.requests)
      .sort((a, b) => priority(a) - priority(b))
      .slice(0, 3),
  }
}

/** Fold the authoritative ordered event snapshot; a reused native ID starts a new request after its old resolution. */
export function inputSummary(events: AgentEvent[], sessionId: string): ThreadInputSummary | null {
  const pending = new Map<string, ThreadInputRequest>()
  for (const event of events) {
    if (event.agentId && !event.requestSource) continue
    if (event.kind === 'request-resolved') pending.delete(event.requestId)
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
    'request-resolved',
    'recovery',
  ].includes(event.kind)
}
