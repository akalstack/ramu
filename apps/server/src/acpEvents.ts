import { randomUUID } from 'node:crypto'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import type { AgentEvent, AgentTask, AgentToolDetails, AgentToolStatus } from '@ramu/shared/types'
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

/** Inline image bytes would bloat the stored transcript, and `formatted_output` repeats the output a runtime already sent. */
export function stripToolBulk(value: unknown, depth = 0): unknown {
  if (depth > 12) return undefined
  if (typeof value === 'string') return /^data:image\//i.test(value) ? undefined : value
  if (Array.isArray(value)) return value.flatMap((entry) => { const kept = stripToolBulk(entry, depth + 1); return kept === undefined ? [] : [kept] })
  if (!value || typeof value !== 'object') return value
  const object = value as Update
  const image = object.type === 'image' || typeof object.mimeType === 'string' && object.mimeType.startsWith('image/')
  const entries = Object.entries(object).flatMap(([key, entry]): [string, unknown][] => {
    if (image && (key === 'data' || key === 'blob')) return []
    if ((key === 'formatted_output' || key === 'formattedOutput') && (entry === object.combinedOutput || entry === object.combined_output)) return []
    const kept = stripToolBulk(entry, depth + 1)
    return kept === undefined ? [] : [[key, kept]]
  })
  return Object.fromEntries(entries)
}
const field = (source: unknown, ...names: string[]): unknown => {
  if (!source || typeof source !== 'object') return undefined
  for (const name of names) if ((source as Update)[name] != null) return (source as Update)[name]
  return undefined
}
/** Antigravity's shell tool reports its command and result under its own field names rather than in standard tool content. */
export function nativeShell(rawInput: unknown, rawOutput: unknown): { command?: string; cwd?: string; output?: string; exitCode?: number } | undefined {
  const command = text(field(rawInput, 'CommandLine', 'command_line', 'commandLine', 'command') ?? field(rawOutput, 'commandLine', 'command_line'))?.trim()
  const output = text(field(rawOutput, 'combinedOutput', 'combined_output'))
  const exitCode = field(rawOutput, 'exitCode', 'exit_code')
  const cwd = text(field(rawInput, 'Cwd', 'WorkingDirectory', 'working_dir', 'workingDir', 'cwd') ?? field(rawOutput, 'workingDir', 'working_dir'))?.trim()
  if (!command && output === undefined) return undefined
  return { ...(command ? { command } : {}), ...(cwd ? { cwd } : {}), ...(output !== undefined ? { output } : {}), ...(Number.isInteger(exitCode) ? { exitCode: exitCode as number } : {}) }
}

/** One ACP boundary for external runtimes and Ramu-owned hosts. Updates are snapshots; chunks are deltas. */
export class AcpEvents {
  private stream?: { kind: 'text' | 'thinking'; messageId: string; text: string }
  private tools = new Map<string, Extract<AgentEvent, { kind: 'tool-use' }>>()
  private planId = randomUUID()
  private agents = new Map<string, AgentTask>()
  private children = new Map<string, { agentId?: string; events: AcpEvents }>()
  /** Antigravity runs a separate `start_subagent` step; its outcome is the helper's real one. */
  private launches = new Map<string, { failed: boolean; report: string }>()
  /** Cursor's running todo list; it belongs to the session, so it carries across turns. */
  private todos = new Map<string, { content: string; status: 'pending' | 'in_progress' | 'completed' }>()
  /** `subagentTools` names tool calls that start a sub-agent, so they also appear as task cards. */
  constructor(private nativeExtensions = false, private subagentTools: string[] = []) {}
  beginTurn(): void { this.stream = undefined; this.tools.clear(); this.planId = randomUUID() }
  /** Turns one runtime-reported child-session update into events on the matching task card. */
  consumeChild(childId: string, title: string, update: Update): AgentEvent[] {
    let child = this.children.get(childId)
    if (!child) this.children.set(childId, child = { events: new AcpEvents() })
    if (!child.agentId) {
      // The child carries the task's description as its title; a lone running task is the fallback.
      const claimed = new Set([...this.children.values()].map((entry) => entry.agentId))
      const open = [...this.agents.values()].filter((task) => task.status === 'running' && !claimed.has(task.agentId))
      child.agentId = (open.find((task) => task.name === title) ?? (open.length === 1 ? open[0] : undefined))?.agentId
    }
    const agentId = child.agentId
    if (!agentId) return []
    return child.events.consume(update).flatMap((event): AgentEvent[] =>
      event.kind === 'text' || event.kind === 'thinking' || event.kind === 'tool-use' || event.kind === 'tool-result' ? [{ ...event, agentId }] : [])
  }
  /** Cursor reports its todo list through `cursor/update_todos` rather than a standard `plan` update; `merge` patches the list instead of replacing it. */
  updateTodos(p: Update): AgentEvent[] {
    if (!Array.isArray(p.todos)) return []
    if (p.merge !== true) this.todos.clear()
    for (const todo of p.todos) {
      const content = text(todo?.content)?.trim()
      if (!content) continue
      this.todos.set(text(todo.id) ?? content, { content, status: todo.status === 'in_progress' ? 'in_progress' : todo.status === 'completed' || todo.status === 'cancelled' ? 'completed' : 'pending' })
    }
    return this.todos.size ? [{ kind: 'plan', messageId: this.planId, entries: [...this.todos.values()].map((entry) => ({ ...entry, priority: 'medium' as const })) }] : []
  }
  /** Extra details a runtime sends about a sub-agent outside its tool call (Cursor's `cursor/task`). */
  updateAgent(toolCallId: string, patch: Partial<AgentTask>): AgentEvent | undefined {
    const before = this.agents.get(toolCallId)
    if (!before) return undefined
    const task = { ...before, ...patch }
    this.agents.set(toolCallId, task)
    return { ...task, kind: 'agent' }
  }
  private subagent(call: Extract<AgentEvent, { kind: 'tool-use' }>, u: Update): AgentEvent | undefined {
    const before = this.agents.get(call.toolUseId)
    let input: Update = {}
    try { input = u.rawInput && typeof u.rawInput === 'object' ? u.rawInput : JSON.parse(call.input ?? '{}') } catch {}
    // Cursor names the tool only inside its input; Antigravity only in the permission title ("Run invoke_subagent?").
    const names = [call.name, text(input._toolName), /^(?:Run )?(\w+)\??$/.exec(call.title ?? '')?.[1]]
    if (!before && !names.some((name) => name && this.subagentTools.includes(name.toLowerCase()))) return undefined
    // Antigravity batches helpers as {Subagents:[{Prompt, Role, TypeName}]}; one card covers the batch.
    const batch: Update[] = Array.isArray(input.Subagents) ? input.Subagents.filter((entry: Update) => entry && typeof entry === 'object') : []
    const prompt = text(input.prompt) ?? (batch.length ? batch.map((entry) => text(entry.Prompt) ?? '').filter(Boolean).join('\n\n') : undefined)
    // Cursor describes the type as a tagged object such as {unspecified:{}} or {explore:{}}.
    const rawType = input.agent ?? input.subagent_type ?? input.subagentType ?? batch[0]?.Role
    const type = typeof rawType === 'object' ? Object.keys(rawType ?? {}).find((key) => !['unspecified', 'custom'].includes(key)) : rawType
    const now = Date.now()
    // The report arrives wrapped as <subagent sessionID=… state=…>…</subagent>.
    const report = contentSummary(call.content ?? []).replace(/^\s*<subagent\b[^>]*>\s*|\s*<\/subagent>\s*$/g, '').trim()
    // Antigravity marks its launcher call failed once the helpers have run; that is not a helper failure.
    const launcherDone = call.status === 'failed' && /never executed/i.test(report)
    const launch = this.launches.get(call.toolUseId)
    const status = before?.status === 'stopped' ? 'stopped' : call.status === 'completed' || launcherDone && !launch?.failed ? 'completed' : call.status === 'failed' ? 'failed' : 'running'
    const fallbackName = prompt ? prompt.split('\n')[0]!.slice(0, 80) : call.title
    const task: AgentTask = {
      ...before, agentId: call.toolUseId, toolUseId: call.toolUseId, taskType: 'local_agent', status, canStop: status === 'running',
      name: text(input.description)?.trim() || before?.name || fallbackName || 'Sub-agent',
      ...(text(type) ? { agentType: type } : {}),
      ...(prompt ? { prompt } : {}),
      ...(report && !launcherDone ? { summary: report } : {}), ...(status === 'failed' ? { error: (launcherDone ? launch?.report : report) || 'The sub-agent failed' } : {}),
      startedAt: before?.startedAt ?? now, ...(status === 'running' ? {} : { endedAt: before?.endedAt ?? now, durationMs: before?.durationMs ?? now - (before?.startedAt ?? now) }),
    }
    this.agents.set(call.toolUseId, task)
    return { ...task, kind: 'agent' }
  }
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
      u = { ...u, ...(u.rawInput != null ? { rawInput: stripToolBulk(u.rawInput) } : {}), ...(u.rawOutput != null ? { rawOutput: stripToolBulk(u.rawOutput) } : {}), ...(Array.isArray(u.content) ? { content: stripToolBulk(u.content) } : {}) }
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
      const shell = nativeShell(u.rawInput, u.rawOutput)
      if (shell) {
        // Show the command itself rather than the runtime's generic "Running run_command" title.
        if (!details.toolKind || details.toolKind === 'other') details.toolKind = 'execute'
        if (shell.command && (!details.title || /^(?:Running|Run) [\w.-]+\??$/.test(details.title))) details.title = shell.command
      }
      if (Array.isArray(u.content) && u.content.length) details.content = agentContent(u.content)
      else if (shell?.output !== undefined && !details.content?.length) details.content = shell.output ? [{ type: 'text', text: shell.output }] : []
      else if (Array.isArray(u.content)) details.content = agentContent(u.content)
      else if (u.rawOutput != null && !details.content?.length) details.content = typeof u.rawOutput === 'string' || Array.isArray(u.rawOutput) && u.rawOutput.every((b: Update) => b && typeof b.type === 'string') ? agentContent(u.rawOutput) : [{ type: 'text', text: toolInput(u.rawOutput) ?? '' }]
      if (Array.isArray(u.locations)) details.locations = u.locations.filter((l: Update) => typeof l?.path === 'string').map((l: Update) => ({ path: l.path, ...(Number.isInteger(l.line) && l.line >= 0 ? { line: l.line } : {}) }))
      const name = text(u.name)?.trim() || previous?.name || text(u.kind) || 'Tool'
      const call: Extract<AgentEvent, { kind: 'tool-use' }> = { ...details, kind: 'tool-use', toolUseId: u.toolCallId, name, summary: details.input ?? details.title ?? previous?.summary ?? '' }
      this.tools.set(u.toolCallId, call)
      const events: AgentEvent[] = [call]
      if (/start_subagent/.test(call.title ?? '') && terminal(details.status)) {
        // Credit the outcome to the helper card still waiting on it.
        const owner = [...this.agents.values()].reverse().find((task) => task.status === 'running' && !this.launches.has(task.agentId))
        if (owner) this.launches.set(owner.agentId, { failed: details.status === 'failed', report: contentSummary(details.content ?? []) })
      }
      const agent = this.subagent(call, u)
      if (Array.isArray(u.content) || u.rawOutput != null || details.content?.length || terminal(details.status)) events.push({ ...details, kind: 'tool-result', toolUseId: u.toolCallId, isError: details.status === 'failed', summary: contentSummary(details.content ?? []), running: !terminal(details.status) })
      if (agent) events.push(agent)
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
