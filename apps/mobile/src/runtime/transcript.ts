import type { AgentEvent } from '@ramu/shared/types'
import type { TranscriptItem } from './types'
import { advisorTranscript, latestTasks, parseAdvice, parseTaskMessage, parseTaskReport, parseTaskStop } from '@ramu/shared/agentTasks'
import { parseAnswerMessage } from '@ramu/shared/questions'
import { goalChanges } from '@ramu/shared/goalHistory'

/** What the person typed: the file context Ramu appends for the agent (`<ramu-context>…`) is hidden, as on the desktop. */
export const visibleText = (text: string) => text.split(/\n*<ramu-context>/)[0]!.trimEnd()

export function transcript(events: AgentEvent[], seqs?: number[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const resolved = new Map<string, string>()
  const answers = new Map<string, Record<string, string>>()
  const results = new Map<string, Extract<AgentEvent, { kind: 'tool-result' }>>()
  const helpers = new Map<string, Extract<AgentEvent, { kind: 'agent' }>>()
  const goals = goalChanges(events)
  const logs = new Map<string, string[]>()
  for (const e of events) if (e.agentId && e.kind === 'text') logs.set(e.agentId, [...(logs.get(e.agentId) ?? []), e.text])
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
    if (e.kind === 'user' && !e.agentId && (parseTaskReport(e.text) || parseAdvice(e.text) || parseTaskStop(e.text) || parseTaskMessage(e.text) || parseAnswerMessage(e.text))) {
      // Messages Ramu writes on your behalf are status lines, not something you typed, as on the desktop.
      const report = parseTaskReport(e.text), advice = parseAdvice(e.text), stop = parseTaskStop(e.text), relay = parseTaskMessage(e.text), answers = parseAnswerMessage(e.text)
      items.push(report ? { kind: 'text', id, text: `**${report.name}** ${report.verb}\n\n${report.body}` }
        : advice ? { kind: 'note', id, title: advice.failed ? `The advisor could not answer: ${advice.body}` : 'Advice delivered to the agent', detail: advice.advisor, failed: advice.failed }
        : stop ? { kind: 'note', id, title: `Asked the agent to stop ${stop.name}` }
        : relay ? { kind: 'note', id, title: `Message to ${relay.name}`, detail: relay.body }
        : { kind: 'note', id, title: "Answers to the agent's questions", detail: answers!.body } as TranscriptItem)
    }
    else if (e.kind === 'goal' && goals.has(e)) {
      const { type, goal } = goals.get(e)!
      const verb = { set: 'Goal set', edited: 'Goal edited', paused: 'Goal paused', resumed: 'Goal resumed', blocked: 'Goal blocked', 'turn-limit': 'Goal reached its turn limit', cleared: 'Goal cleared' }[type]
      items.push({ kind: 'note', id, title: verb, detail: goal.objective, failed: type === 'blocked' })
    }
    else if (e.kind === 'schedule') items.push({ kind: 'note', id, title: `Schedule created: ${e.schedule.name}`, detail: e.schedule.state === 'paused' ? 'Paused' : undefined })
    else if (e.kind === 'user') items.push({ kind: 'user', id, text: visibleText(e.text), at: e.at ?? 0, attachments: e.attachments, seq: seqs?.[index], raw: e.text })
    else if (e.kind === 'text') items.push({ kind: 'text', id, text: e.text })
    else if (e.kind === 'error') items.push({ kind: 'text', id, text: `Error: ${e.message}` })
    else if (e.kind === 'content') {
      const text = e.content.filter(c => c.type !== 'image').map(c => 'text' in c && typeof c.text === 'string' ? c.text : c.type === 'resource' ? c.name : c.type === 'unsupported' ? c.label : '').filter(Boolean).join('\n')
      if (text) items.push({ kind: 'text', id, text })
      e.content.forEach((c, n) => { if (c.type === 'image' && (c.data || c.uri)) items.push({ kind: 'image', id: `${id}-img-${n}`, uri: c.data ? `data:${c.mimeType};base64,${c.data}` : c.uri!, alt: c.alt }) })
    }
    else if (e.kind === 'plan') items.push({ kind: 'text', id, text: e.entries.map(x => `${x.status === 'completed' ? '✓' : '•'} ${x.content}`).join('\n') })
    else if (e.kind === 'tool-use') {
      const result = results.get(`:${e.toolUseId}`)
      items.push({ kind: 'tool', id: e.toolUseId, tool: ['read', 'edit', 'search', 'execute', 'think', 'fetch'].includes(e.toolKind ?? '') ? e.toolKind as any : 'other', verb: e.name, subject: e.title || e.summary, status: result ? result.isError ? 'failed' : result.running ? 'in_progress' : 'completed' : e.status === 'failed' ? 'failed' : 'in_progress', detail: result?.summary || e.input })
    } else if (e.kind === 'question') items.push({ kind: 'question', id: e.requestId, questions: e.questions.filter(q => resolved.has(e.requestId) || !answers.get(e.requestId)?.[q.id ?? q.question]), submitted: answers.get(e.requestId), answers: resolved.has(e.requestId) ? answers.get(e.requestId) ?? { _: resolved.get(e.requestId)! } : undefined })
    else if (e.kind === 'permission-request') items.push({ kind: 'permission', id: e.requestId, title: e.title, command: e.detail, decision: resolved.has(e.requestId) ? /allow|approv/.test(resolved.get(e.requestId)!) ? 'allow' : 'deny' : undefined })
    else if (e.kind === 'elicitation') items.push({ kind: 'elicitation', id: e.requestId, request: e, outcome: resolved.get(e.requestId) })
    else if (e.kind === 'goal' && e.goal?.status === 'completed') items.push({ kind: 'goal', id, objective: e.goal.objective, turns: e.goal.turns })
    else if (e.kind === 'settings') items.push({ kind: 'note', id, title: '', detail: e.reason + (e.handoff ? ' · Conversation context handed over' : ''), settings: e.settings, previous: e.previous })
    else if (e.kind === 'recovery') items.push({ kind: 'note', id, title: 'Continued after restart' })
    else if (e.kind === 'compaction' && e.state !== 'started') items.push({ kind: 'note', id, title: e.state === 'failed' ? 'Could not compact the conversation' : e.beforeTokens && e.afterTokens ? `Conversation compacted · ${Math.round(e.beforeTokens / 1000)}k → ${Math.round(e.afterTokens / 1000)}k tokens` : 'Conversation compacted', failed: e.state === 'failed' })
    else if (e.kind === 'result') items.push({ kind: 'end', id, ended: true, interrupted: e.isError || /interrupt|abort/i.test(e.text) })
    else if (e.kind === 'state' && ['idle', 'failed', 'stopped'].includes(e.state)) items.push({ kind: 'end', id, ended: false, interrupted: false })
    // Timestamps place steps in time, so a finished turn can say how long it worked.
    if (e.at !== undefined) for (let i = before; i < items.length; i++) items[i] = { at: e.at, ...items[i]! } as TranscriptItem
  })
  // Waiting on a provider's usage limit, as the desktop shows it: only while nothing has happened since.
  const lastWait = events.findLastIndex(e => e.kind === 'provider-wait')
  const wait = lastWait >= 0 ? events[lastWait] as Extract<AgentEvent, { kind: 'provider-wait' }> : undefined
  if (wait && !events.slice(lastWait + 1).some(e => !e.agentId && (e.kind === 'text' || e.kind === 'tool-use' || e.kind === 'result' || e.kind === 'user' || e.kind === 'state' && e.state !== 'running' && e.state !== 'starting')))
    items.push({ kind: 'note', id: `wait-${lastWait}`, wait: true, title: wait.retryAt ? `Waiting for the provider's usage limit · retrying at ${new Date(wait.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : "Waiting for the provider's usage limit" })
  // The desktop's own task list: sub-agents plus advisors recovered from the advice delivered to the chat.
  const tasks = latestTasks(events)
  if (tasks.length) items.push({ kind: 'agents', id: 'helpers', agents: tasks.map(t => {
    const own = t.taskType === 'advisor' ? advisorTranscript(events, t.agentId) : events.filter(e => e.agentId === t.agentId)
    const log = own.flatMap(e => e.kind === 'text' ? [e.text] : e.kind === 'error' ? [`Error: ${e.message}`] : []).join('\n\n')
    return { id: t.agentId, prompt: t.prompt, log, name: t.name, type: t.agentType ?? t.taskType ?? '', status: t.status === 'stopped' ? 'failed' as const : t.status, summary: t.summary ?? t.error ?? '' }
  }) })
  return items
}
