// OpenCode's official SDK. Each runner owns a local server and uses the existing CLI credentials.
import { createOpencodeClient, type OpencodeClient, type Event, type PermissionRuleset, type Part, type QuestionInfo, type V2Event } from '@opencode-ai/sdk/v2'
import { startOpenCodeServer } from './opencodeServer'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import type { AgentEvent, AgentModel, AgentScope, AgentSettings, Attachment, McpConnection } from '../shared/types'
import { attachmentPrompt } from './attachments'
import type { AgentRunner, AgentRunnerFactory } from './agentRunner'

export function openCodePermissions(settings: AgentSettings, readOnly: boolean): PermissionRuleset {
  return [{ permission: '*', pattern: '*', action: readOnly ? 'deny' : settings.access === 'full' ? 'allow' : 'ask' },
    ...(!readOnly && settings.access === 'edits' ? [{ permission: 'edit', pattern: '*', action: 'allow' as const }] : []),
    { permission: 'question', pattern: '*', action: readOnly ? 'deny' : 'allow' }]
}
export function openCodeModel(id: string): { providerID: string; modelID: string } {
  const split = id.indexOf('/')
  if (split <= 0 || split === id.length - 1) throw new Error('OpenCode model must include its provider: provider/model')
  return { providerID: id.slice(0, split), modelID: id.slice(split + 1) }
}
export async function openCodeUsesV2(client: OpencodeClient): Promise<boolean> {
  try {
    const result = await client.v2.model.list()
    if (result.response.status === 401 || result.response.status === 403) throw new Error('OpenCode server authentication failed')
    return result.response.ok
  } catch (error) {
    if (String(error).includes('text/html')) return false
    throw error
  }
}
export async function openCodeModels(): Promise<AgentModel[]> {
  const server = await startOpenCodeServer(homedir())
  try {
    const client = createOpencodeClient({ baseUrl: server.url, headers: server.headers, directory: homedir() })
    if (await openCodeUsesV2(client)) {
      const { data } = await client.v2.model.list({}, { throwOnError: true })
      return data.data.filter((m) => m.enabled && m.status !== 'deprecated').map((m, index) => ({ provider: 'opencode', id: `${m.providerID}/${m.id}`, name: m.name, efforts: [], defaultEffort: null, isDefault: index === 0 }))
    }
    const { data } = await client.provider.list({}, { throwOnError: true })
    return data.all.filter((p) => data.connected.includes(p.id)).flatMap((p) => Object.values(p.models).map((m) => ({ provider: 'opencode' as const, id: `${p.id}/${m.id}`, name: `${m.name} · ${p.name}`, efforts: [], defaultEffort: null, isDefault: data.default[p.id] === m.id })))
  } finally { await server.close() }
}
export const createOpenCodeRunner: AgentRunnerFactory = (scope, settings, emit, readOnly) => new OpenCodeSession(scope, settings, emit, readOnly)
class OpenCodeSession implements AgentRunner {
  private client?: OpencodeClient
  private server?: Awaited<ReturnType<typeof startOpenCodeServer>>
  private abort = new AbortController()
  private sessionId = ''
  private apiV2 = false
  private turnError = ''
  private turnCost = 0
  private stopped = false
  private active?: Promise<void>
  private eventsDone?: Promise<void>
  private connection?: McpConnection
  private pending = new Map<string, { kind: 'permission' | 'question'; questions?: QuestionInfo[] }>()
  private texts = new Map<string, string>()
  private tools = new Set<string>()
  private completedTools = new Set<string>()
  private roles = new Map<string, string>()
  private bufferedParts = new Map<string, Part>()
  constructor(private scope: AgentScope, private settings: AgentSettings, private emit: (event: AgentEvent, limit?: boolean) => void, private readOnly = false) {}
  setTools(connection: McpConnection): void { this.connection = connection }
  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    this.server = await startOpenCodeServer(this.scope.cwd, this.abort.signal, this.settings.accountId ?? 'default')
    this.client = createOpencodeClient({ baseUrl: this.server.url, headers: this.server.headers, directory: this.scope.cwd })
    if (this.stopped) { await this.server.close(); return }
    this.apiV2 = await openCodeUsesV2(this.client)
    if (this.apiV2) { await this.startV2(prompt, resume, attachments); return }
    const permission = openCodePermissions(this.settings, this.readOnly)
    if (resume) {
      const { data } = await this.client.session.get({ sessionID: resume }, { throwOnError: true })
      if (data.directory !== this.scope.cwd) throw new Error('OpenCode session belongs to a different workspace')
      await this.client.session.update({ sessionID: resume, permission }, { throwOnError: true })
      this.sessionId = resume
    } else {
      const { data } = await this.client.session.create({ permission }, { throwOnError: true })
      this.sessionId = data.id
    }
    if (this.connection && !this.readOnly) await this.client.mcp.add({ name: 'ramu', config: { type: 'remote', url: this.connection.url, headers: { Authorization: `Bearer ${this.connection.token}` }, enabled: true } }, { throwOnError: true })
    const events = await this.client.event.subscribe({}, { signal: this.abort.signal, throwOnError: true })
    this.eventsDone = (async () => {
      for await (const event of events.stream) { if (this.stopped) break; this.handle(event) }
      if (!this.stopped) throw new Error('OpenCode event stream closed')
    })().catch((e) => { if (!this.stopped) { this.emit({ kind: 'error', message: String(e) }); this.emit({ kind: 'state', state: 'failed' }) } })
    this.emit({ kind: 'init', model: this.settings.model || 'OpenCode default', cwd: this.scope.cwd, providerSessionId: this.sessionId })
    await this.send(prompt, attachments)
  }
  async send(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (this.active) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    if (!this.client || this.stopped) throw new Error('OpenCode session is not running')
    if (this.apiV2) { await this.sendV2(prompt, attachments); return }
    this.emit({ kind: 'state', state: 'running' })
    this.active = this.client.session.prompt({ sessionID: this.sessionId, ...(this.settings.model ? { model: openCodeModel(this.settings.model) } : {}),
      parts: [{ type: 'text', text: attachmentPrompt(prompt, attachments) }, ...attachments.filter((f) => f.mimeType.startsWith('image/')).map((f) => ({ type: 'file' as const, mime: f.mimeType, filename: f.name, url: `data:${f.mimeType};base64,${readFileSync(f.path).toString('base64')}` }))],
    }, { throwOnError: true, signal: this.abort.signal }).then(({ data }) => {
      this.active = undefined
      if (this.stopped) return
      for (const part of data.parts) this.part(part)
      const error = data.info.error
      this.emit({ kind: 'result', isError: !!error, text: error ? JSON.stringify(error) : 'Completed', costUsd: data.info.cost }, error ? /usage.?limit|rate.?limit|quota|429/i.test(JSON.stringify(error)) : false)
    }, (e) => {
      this.active = undefined
      if (!this.stopped) this.emit({ kind: 'result', isError: true, text: String(e), costUsd: null }, /usage.?limit|rate.?limit|quota|429/i.test(String(e)))
    })
  }
  async steer(): Promise<void> { throw new Error('OpenCode accepts follow-ups after the current turn; use Queue.') }
  async interrupt(): Promise<void> { if (this.active) { await (this.apiV2 ? this.client!.v2.session.interrupt({ sessionID: this.sessionId }, { throwOnError: true }) : this.client!.session.abort({ sessionID: this.sessionId }, { throwOnError: true })); await this.active } }
  async stop(): Promise<void> {
    this.stopped = true
    try { if (this.active && this.client) await (this.apiV2 ? this.client.v2.session.interrupt({ sessionID: this.sessionId }, { throwOnError: true, signal: AbortSignal.timeout(5000) }) : this.client.session.abort({ sessionID: this.sessionId }, { throwOnError: true, signal: AbortSignal.timeout(5000) })) }
    finally {
      this.abort.abort(); await this.server?.close(); await this.active; await this.eventsDone
      for (const [id] of this.pending) this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
      this.pending.clear()
    }
  }
  private resolved(id: string, outcome: string): void {
    this.pending.delete(id); this.emit({ kind: 'request-resolved', requestId: id, outcome })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  replyPermission(id: string, allow: boolean): void {
    if (this.pending.get(id)?.kind !== 'permission') throw new Error('That request is no longer pending')
    void (this.apiV2 ? this.client!.v2.session.permission.reply({ sessionID: this.sessionId, requestID: id, reply: allow ? 'once' : 'reject' }, { throwOnError: true }) : this.client!.permission.reply({ requestID: id, reply: allow ? 'once' : 'reject' }, { throwOnError: true })).then(() => this.resolved(id, allow ? 'allowed' : 'denied'), (e) => this.emit({ kind: 'error', message: String(e) }))
  }
  replyQuestion(id: string, answers: Record<string, string>): void {
    const pending = this.pending.get(id)
    if (pending?.kind !== 'question') throw new Error('That request is no longer pending')
    const selected = pending.questions!.map((q) => q.multiple ? (answers[q.question] || '').split(', ').filter(Boolean) : [answers[q.question] || ''])
    void (this.apiV2 ? this.client!.v2.session.question.reply({ sessionID: this.sessionId, requestID: id, questionV2Reply: { answers: selected } }, { throwOnError: true }) : this.client!.question.reply({ requestID: id, answers: selected }, { throwOnError: true })).then(() => this.resolved(id, 'answered'), (e) => this.emit({ kind: 'error', message: String(e) }))
  }
  private async startV2(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    const client = this.client!
    const model = this.settings.model ? openCodeModel(this.settings.model) : undefined
    const { data: agents } = await client.v2.agent.list({ location: { directory: this.scope.cwd } }, { throwOnError: true })
    const agent = this.readOnly ? agents.data.find((a) => a.id === 'plan') : undefined
    if (this.readOnly && !agent) throw new Error('OpenCode does not advertise a plan agent for background analysis')
    if (resume) {
      const { data } = await client.v2.session.get({ sessionID: resume }, { throwOnError: true })
      if (data.data.location.directory !== this.scope.cwd) throw new Error('OpenCode session belongs to a different workspace')
      this.sessionId = resume
      if (model) await client.v2.session.switchModel({ sessionID: resume, model: { providerID: model.providerID, id: model.modelID } }, { throwOnError: true })
      if (agent) await client.v2.session.switchAgent({ sessionID: resume, agent: agent.id }, { throwOnError: true })
    } else {
      const { data } = await client.v2.session.create({ location: { directory: this.scope.cwd }, ...(model ? { model: { providerID: model.providerID, id: model.modelID } } : {}), ...(agent ? { agent: agent.id } : {}) }, { throwOnError: true })
      this.sessionId = data.data.id
    }
    // Subscribe to current native events rather than replaying a restored transcript.
    const events = await client.v2.event.subscribe({ signal: this.abort.signal, throwOnError: true })
    this.eventsDone = (async () => {
      for await (const event of events.stream) { if (this.stopped) break; this.handleV2(event) }
      if (!this.stopped) throw new Error('OpenCode event stream closed')
    })().catch((error) => { if (!this.stopped) { this.emit({ kind: 'error', message: String(error) }); this.emit({ kind: 'state', state: 'failed' }) } })
    this.emit({ kind: 'init', model: this.settings.model || 'OpenCode default', cwd: this.scope.cwd, providerSessionId: this.sessionId })
    await this.send(prompt, attachments)
  }
  private async sendV2(prompt: string, attachments: Attachment[]): Promise<void> {
    this.turnError = ''; this.turnCost = 0
    this.emit({ kind: 'state', state: 'running' })
    this.active = (async () => {
      try {
        await this.client!.v2.session.prompt({ sessionID: this.sessionId, prompt: { text: attachmentPrompt(prompt, attachments), files: attachments.filter((f) => f.mimeType.startsWith('image/')).map((f) => ({ uri: `data:${f.mimeType};base64,${readFileSync(f.path).toString('base64')}`, name: f.name })) }, delivery: 'queue' }, { throwOnError: true, signal: this.abort.signal })
        await this.client!.v2.session.wait({ sessionID: this.sessionId }, { throwOnError: true, signal: this.abort.signal })
        this.active = undefined
        if (!this.stopped) this.emit({ kind: 'result', isError: !!this.turnError, text: this.turnError || 'Completed', costUsd: this.turnCost }, /usage.?limit|rate.?limit|quota|429/i.test(this.turnError))
      } catch (error) {
        this.active = undefined
        if (!this.stopped) this.emit({ kind: 'result', isError: true, text: String(error), costUsd: null }, /usage.?limit|rate.?limit|quota|429/i.test(String(error)))
      }
    })()
  }
  private handleV2(event: V2Event): void {
    if (!('data' in event)) return
    const p = event.data
    if (!('sessionID' in p) || p.sessionID !== this.sessionId) return
    if (event.type === 'session.next.text.delta') {
      const { textID, delta } = event.data
      const text = (this.texts.get(textID) || '') + delta
      this.texts.set(textID, text); this.emit({ kind: 'text', messageId: textID, text })
    }
    if (event.type === 'session.next.text.ended') { const { textID, text } = event.data; this.texts.set(textID, text); this.emit({ kind: 'text', messageId: textID, text }) }
    if (event.type === 'session.next.tool.called') { const { callID, tool, input } = event.data; this.emit({ kind: 'tool-use', toolUseId: callID, name: tool, summary: JSON.stringify(input) }) }
    if (event.type === 'session.next.tool.success') { const { callID, content } = event.data; this.emit({ kind: 'tool-result', toolUseId: callID, isError: false, summary: content.map((c) => c.type === 'text' ? c.text : c.uri).join('\n') }) }
    if (event.type === 'session.next.tool.failed') { const { callID, error } = event.data; this.emit({ kind: 'tool-result', toolUseId: callID, isError: true, summary: error.message }) }
    if (event.type === 'session.next.step.failed') this.turnError = event.data.error.message
    if (event.type === 'session.next.step.ended') this.turnCost += event.data.cost
    if (event.type === 'permission.v2.asked') {
      const req = event.data
      this.pending.set(req.id, { kind: 'permission' })
      if (this.readOnly || this.settings.access === 'full' || (this.settings.access === 'edits' && ['edit', 'write'].includes(req.action))) { this.replyPermission(req.id, !this.readOnly); return }
      this.emit({ kind: 'permission-request', requestId: req.id, toolName: req.action, title: `Allow ${req.action}?`, detail: req.resources.join('\n') }); this.emit({ kind: 'state', state: 'needs-input' })
    }
    if (event.type === 'question.v2.asked') {
      const req = event.data
      this.pending.set(req.id, { kind: 'question', questions: req.questions })
      if (this.readOnly) { void this.client!.v2.session.question.reject({ sessionID: this.sessionId, requestID: req.id }, { throwOnError: true }).catch((error) => this.emit({ kind: 'error', message: String(error) })); return }
      this.emit({ kind: 'question', requestId: req.id, questions: req.questions.map((q) => ({ question: q.question, header: q.header, multiSelect: !!q.multiple, options: q.options })) }); this.emit({ kind: 'state', state: 'needs-input' })
    }
  }
  private part(part: Part): void {
    if (part.type === 'text') {
      if (this.texts.get(part.id) === part.text) return
      this.texts.set(part.id, part.text); this.emit({ kind: 'text', messageId: part.id, text: part.text })
    }
    if (part.type === 'tool') {
      if (!this.tools.has(part.callID)) { this.tools.add(part.callID); this.emit({ kind: 'tool-use', toolUseId: part.callID, name: part.tool, summary: JSON.stringify(part.state.input) }) }
      if ((part.state.status === 'completed' || part.state.status === 'error') && !this.completedTools.has(part.callID)) { this.completedTools.add(part.callID); this.emit({ kind: 'tool-result', toolUseId: part.callID, isError: part.state.status === 'error', summary: part.state.status === 'completed' ? part.state.output : part.state.error }) }
    }
  }
  private handle(event: Event): void {
    const p = event.properties
    if (!('sessionID' in p) || p.sessionID !== this.sessionId) return
    if (event.type === 'message.updated') {
      const info = event.properties.info
      this.roles.set(info.id, info.role)
      for (const [id, part] of this.bufferedParts) if (part.messageID === info.id) { if (info.role === 'assistant') this.part(part); this.bufferedParts.delete(id) }
    }
    if (event.type === 'message.part.updated') {
      const part = event.properties.part
      if (this.roles.get(part.messageID) === 'assistant') this.part(part)
      else if (!this.roles.has(part.messageID)) this.bufferedParts.set(part.id, part)
    }
    if (event.type === 'message.part.delta') {
      const { partID, messageID, field, delta } = event.properties
      if (field === 'text' && this.roles.get(messageID) === 'assistant') { const text = (this.texts.get(partID) || '') + delta; this.texts.set(partID, text); this.emit({ kind: 'text', messageId: partID, text }) }
    }
    if (event.type === 'permission.asked') {
      const req = event.properties
      this.pending.set(req.id, { kind: 'permission' })
      if (this.readOnly) { this.replyPermission(req.id, false); return }
      this.emit({ kind: 'permission-request', requestId: req.id, toolName: req.permission, title: `Allow ${req.permission}?`, detail: req.patterns.join('\n') }); this.emit({ kind: 'state', state: 'needs-input' })
    }
    if (event.type === 'question.asked') {
      const req = event.properties
      this.pending.set(req.id, { kind: 'question', questions: req.questions })
      if (this.readOnly) { void this.client!.question.reject({ requestID: req.id }, { throwOnError: true }).catch((e) => this.emit({ kind: 'error', message: String(e) })); return }
      this.emit({ kind: 'question', requestId: req.id, questions: req.questions.map((q) => ({ question: q.question, header: q.header, multiSelect: !!q.multiple, options: q.options })) }); this.emit({ kind: 'state', state: 'needs-input' })
    }
  }
}
