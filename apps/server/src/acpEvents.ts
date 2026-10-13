import { randomUUID } from 'node:crypto'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import type { AgentEvent, AgentToolDetails, AgentToolStatus } from '@ramu/shared/types'
import { agentContent, contentSummary } from '@ramu/shared/agentContent'
import { TOOL_KINDS, toolKind } from '@ramu/shared/agentTools'

type Update = Record<string, any>
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
const terminal = (status: AgentToolStatus | undefined) => status === 'completed' || status === 'failed'
export function toolInput(value: unknown): string | undefined {
  if (value == null) return undefined
  try { return (typeof value === 'string' ? value : JSON.stringify(value, null, 2)).slice(0, 256_000) } catch { return undefined }
}
export function toolDescription(input: unknown): string | undefined {
  return input && typeof input === 'object' && typeof (input as Update).description === 'string' ? (input as Update).description : undefined
}

/** One ACP boundary for external runtimes and Ramu-owned hosts. Updates are snapshots; chunks are deltas. */
export class AcpEvents {
  private stream?: { kind: 'text' | 'thinking'; messageId: string; text: string }
  private tools = new Map<string, Extract<AgentEvent, { kind: 'tool-use' }>>()
  private planId = randomUUID()
  constructor(private nativeExtensions = false) {}
  beginTurn(): void { this.stream = undefined; this.tools.clear(); this.planId = randomUUID() }
  consume(u: Update): AgentEvent[] {
    if (this.nativeExtensions && u._meta?.ramu?.version === 1 && u._meta.ramu.event) return [u._meta.ramu.event as AgentEvent]
    if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk') {
      const content = agentContent(u.content)
      const kind = u.sessionUpdate === 'agent_thought_chunk' ? 'thinking' : 'text'
      if (u.content?.type === 'text') {
        if (!this.stream || this.stream.kind !== kind) this.stream = { kind, messageId: randomUUID(), text: '' }
        this.stream.text += String(u.content.text ?? '')
        return [{ kind, text: this.stream.text, messageId: this.stream.messageId }]
      }
      this.stream = undefined
      return content.length ? [{ kind: 'content', content, messageId: randomUUID() }] : []
    }
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      this.stream = undefined
      if (typeof u.toolCallId !== 'string' || !u.toolCallId) return []
      const previous = this.tools.get(u.toolCallId)
      // A late progress packet must not revive a completed tool.
      if (terminal(previous?.status) && !terminal(u.status)) return []
      const details: AgentToolDetails = { ...previous }
      if (TOOL_KINDS.includes(u.kind)) details.toolKind = u.kind
      if (['pending', 'in_progress', 'completed', 'failed'].includes(u.status)) details.status = u.status
      else details.status ??= 'pending'
      if (text(u.title)?.trim()) details.title = u.title
      else if (text(u.description)?.trim()) details.title = u.description
      else if (!details.title && toolDescription(u.rawInput)) details.title = toolDescription(u.rawInput)
      if (u.rawInput != null) details.input = toolInput(u.rawInput)
      if (Array.isArray(u.content)) details.content = agentContent(u.content)
      else if (u.rawOutput != null && !details.content?.length) details.content = typeof u.rawOutput === 'string' || Array.isArray(u.rawOutput) && u.rawOutput.every((b: Update) => b && typeof b.type === 'string') ? agentContent(u.rawOutput) : [{ type: 'text', text: toolInput(u.rawOutput) ?? '' }]
      if (Array.isArray(u.locations)) details.locations = u.locations.filter((l: Update) => typeof l?.path === 'string').map((l: Update) => ({ path: l.path, ...(Number.isInteger(l.line) && l.line >= 0 ? { line: l.line } : {}) }))
      const name = text(u.name)?.trim() || previous?.name || text(u.kind) || 'Tool'
      const call: Extract<AgentEvent, { kind: 'tool-use' }> = { ...details, kind: 'tool-use', toolUseId: u.toolCallId, name, summary: details.input ?? details.title ?? previous?.summary ?? '' }
      this.tools.set(u.toolCallId, call)
      const events: AgentEvent[] = [call]
      if (Array.isArray(u.content) || u.rawOutput != null || details.content?.length || terminal(details.status)) events.push({ ...details, kind: 'tool-result', toolUseId: u.toolCallId, isError: details.status === 'failed', summary: contentSummary(details.content ?? []), running: !terminal(details.status) })
      return events
    }
    if (u.sessionUpdate === 'plan' && Array.isArray(u.entries)) return [{ kind: 'plan', messageId: this.planId, entries: u.entries.filter((e: Update) => typeof e?.content === 'string').map((e: Update) => ({ content: e.content, status: ['pending', 'in_progress', 'completed'].includes(e.status) ? e.status : 'pending', priority: ['low', 'medium', 'high'].includes(e.priority) ? e.priority : 'medium' })) }]
    if (u.sessionUpdate === 'usage_update' && Number.isFinite(u.used) && Number.isFinite(u.size) && u.used >= 0 && u.size > 0) return [{ kind: 'context', used: u.used, max: u.size }]
    return []
  }
}

/** Standard ACP fields remain useful to other clients; native metadata retains exact provider behavior. */
export class AcpEventEncoder {
  private snapshots = new Map<string, string>()
  encode(event: AgentEvent, usageLimit = false): SessionNotification['update'] {
    let u: Update = { sessionUpdate: 'session_info_update' }
    if (event.kind === 'text' || event.kind === 'thinking') {
      const key = `${event.kind}:${event.agentId ?? ''}:${event.messageId ?? ''}`
      const before = this.snapshots.get(key) ?? ''
      this.snapshots.set(key, event.text)
      if (event.text.startsWith(before)) u = { sessionUpdate: event.kind === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk', content: { type: 'text', text: event.text.slice(before.length) } }
    } else if (event.kind === 'tool-use' || event.kind === 'tool-result') {
      u = { sessionUpdate: event.kind === 'tool-use' ? 'tool_call' : 'tool_call_update', toolCallId: event.toolUseId, ...(event.title ? { title: event.title } : {}) }
      if (event.kind === 'tool-use') Object.assign(u, { title: event.title ?? event.summary ?? event.name, kind: toolKind(event), status: event.status ?? 'in_progress', rawInput: event.input ?? event.summary, name: event.name })
      else Object.assign(u, { status: event.status ?? (event.running ? 'in_progress' : event.isError ? 'failed' : 'completed') })
      if (event.content) u.content = event.content.filter(c => c.type !== 'unsupported').map(c => ['diff', 'terminal'].includes(c.type) ? c : { type: 'content', content: c.type === 'resource' ? c.text === undefined && c.blob === undefined ? { type: 'resource_link', uri: c.uri, name: c.name, ...(c.mimeType ? { mimeType: c.mimeType } : {}) } : { type: 'resource', resource: { uri: c.uri, ...(c.mimeType ? { mimeType: c.mimeType } : {}), ...(c.text !== undefined ? { text: c.text } : { blob: c.blob ?? '' }) } } : c })
      else if (event.kind === 'tool-result') u.content = [{ type: 'content', content: { type: 'text', text: event.summary } }]
      if (event.locations) u.locations = event.locations
    } else if (event.kind === 'content' && event.content[0] && ['text', 'image', 'audio'].includes(event.content[0].type)) u = { sessionUpdate: 'agent_message_chunk', content: event.content[0] }
    else if (event.kind === 'plan') u = { sessionUpdate: 'plan', entries: event.entries }
    else if (event.kind === 'context') u = { sessionUpdate: 'usage_update', used: event.used, size: event.max }
    if (event.kind === 'result' && !event.agentId) for (const key of this.snapshots.keys()) if (key.startsWith('text::') || key.startsWith('thinking::')) this.snapshots.delete(key)
    u._meta = { ramu: { version: 1, event, usageLimit } }
    return u as SessionNotification['update']
  }
}
