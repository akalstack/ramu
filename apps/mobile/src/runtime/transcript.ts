import type { AgentEvent } from '@ramu/shared/types'
import type { TranscriptItem } from './types'

export function transcript(events: AgentEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const resolved = new Map<string, string>()
  const answers = new Map<string, Record<string, string>>()
  const results = new Map<string, Extract<AgentEvent, { kind: 'tool-result' }>>()
  const helpers = new Map<string, Extract<AgentEvent, { kind: 'agent' }>>()
  for (const e of events) {
    if (e.kind === 'request-resolved') resolved.set(e.requestId, e.outcome)
    if (e.kind === 'question-state' && e.answers) answers.set(e.requestId, e.answers)
    if (e.kind === 'tool-result') results.set(`${e.agentId ?? ''}:${e.toolUseId}`, e)
    if (e.kind === 'agent') helpers.set(e.agentId, e)
  }
  events.forEach((e, index) => {
    if (e.agentId && e.kind !== 'agent') return
    const id = `event-${index}`
    const before = items.length
    if (e.kind === 'user') items.push({ kind: 'user', id, text: e.text + (e.attachments?.length ? `\n${e.attachments.map(a => `📎 ${a.name}`).join('\n')}` : ''), at: e.at ?? 0 })
    else if (e.kind === 'text') items.push({ kind: 'text', id, text: e.text })
    else if (e.kind === 'error') items.push({ kind: 'text', id, text: `Error: ${e.message}` })
    else if (e.kind === 'content') items.push({ kind: 'text', id, text: e.content.map(c => 'text' in c ? c.text : JSON.stringify(c)).join('\n') })
    else if (e.kind === 'plan') items.push({ kind: 'text', id, text: e.entries.map(x => `${x.status === 'completed' ? '✓' : '•'} ${x.content}`).join('\n') })
    else if (e.kind === 'tool-use') {
      const result = results.get(`:${e.toolUseId}`)
      items.push({ kind: 'tool', id: e.toolUseId, tool: ['read', 'edit', 'search', 'execute', 'think', 'fetch'].includes(e.toolKind ?? '') ? e.toolKind as any : 'other', verb: e.name, subject: e.title || e.summary, status: result ? result.isError ? 'failed' : result.running ? 'in_progress' : 'completed' : e.status === 'failed' ? 'failed' : 'in_progress', detail: result?.summary || e.input })
    } else if (e.kind === 'question') items.push({ kind: 'question', id: e.requestId, questions: e.questions.filter(q => resolved.has(e.requestId) || !answers.get(e.requestId)?.[q.id ?? q.question]), submitted: answers.get(e.requestId), answers: resolved.has(e.requestId) ? answers.get(e.requestId) ?? { _: resolved.get(e.requestId)! } : undefined })
    else if (e.kind === 'permission-request') items.push({ kind: 'permission', id: e.requestId, title: e.title, command: e.detail, decision: resolved.has(e.requestId) ? /allow|approv/.test(resolved.get(e.requestId)!) ? 'allow' : 'deny' : undefined })
    else if (e.kind === 'elicitation') items.push({ kind: 'elicitation', id: e.requestId, request: e, outcome: resolved.get(e.requestId) })
    else if (e.kind === 'goal' && e.goal?.status === 'completed') items.push({ kind: 'goal', id, objective: e.goal.objective, turns: e.goal.turns })
    else if (e.kind === 'result') items.push({ kind: 'end', id, ended: true, interrupted: e.isError || /interrupt|abort/i.test(e.text) })
    else if (e.kind === 'state' && ['idle', 'failed', 'stopped'].includes(e.state)) items.push({ kind: 'end', id, ended: false, interrupted: false })
    // Timestamps place steps in time, so a finished turn can say how long it worked.
    if (e.at !== undefined) for (let i = before; i < items.length; i++) items[i] = { at: e.at, ...items[i]! } as TranscriptItem
  })
  if (helpers.size) items.push({ kind: 'agents', id: 'helpers', agents: [...helpers.values()].map(e => ({ name: e.name, type: e.agentType ?? e.taskType ?? '', status: e.status === 'stopped' ? 'failed' : e.status, summary: e.summary ?? e.error ?? '' })) })
  return items
}
