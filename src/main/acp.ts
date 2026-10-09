// Native Cursor and Google Antigravity ACP runtimes; JSON-RPC 2.0, newline framing.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentModel, AgentScope, AgentSettings, Attachment, McpConnection } from '../shared/types'
import { providerName } from '../shared/providers'
import { attachmentPrompt } from './attachments'
import type { AgentRunner, AgentRunnerFactory } from './agentRunner'

type Wire = Record<string, any>
type AcpProvider = 'cursor' | 'antigravity'
export function acpCommand(provider: AcpProvider): { command: string; args: string[] } {
  return { command: providerBinary(provider), args: provider === 'cursor' ? ['acp'] : process.platform === 'linux' ? ['--uid='] : [] }
}
export class AcpRpc {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private closed = false
  private stopping = false
  private pending = new Map<number, { resolve: (r: Wire) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>()
  readonly exited: Promise<void>
  onMessage: (message: Wire) => void = () => {}
  onExit: (error: Error) => void = () => {}
  constructor(private provider: AcpProvider, cwd: string) {
    const { command, args } = acpCommand(provider)
    this.child = spawn(command, args, { cwd, stdio: 'pipe', env: providerEnvironment(provider) })
    this.child.stderr.resume()
    this.child.stdin.on('error', () => {})
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      let m: Wire
      try { m = JSON.parse(line) } catch { return }
      if (!m.method && typeof m.id === 'number') {
        const pending = this.pending.get(m.id)
        if (!pending) return
        this.pending.delete(m.id); clearTimeout(pending.timer)
        if (m.error) pending.reject(new Error(m.error.message || `${providerName(provider)} request failed`))
        else pending.resolve(m.result ?? {})
      } else this.onMessage(m)
    })
    this.exited = new Promise((resolve) => {
      const finish = (error: Error) => {
        if (this.closed) return
        this.closed = true
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
        this.pending.clear(); lines.close()
        if (!this.stopping) this.onExit(error)
        resolve()
      }
      this.child.once('error', (e) => finish(new Error(`Cannot start ${providerName(provider)}. Install and sign in to its ${provider === 'cursor' ? 'CLI (agent login)' : 'official ACP runtime'} first. ${e.message}`)))
      this.child.once('exit', (code) => finish(new Error(`${providerName(provider)} ACP runtime exited (${code ?? 'signal'})`)))
    })
  }
  write(message: Wire): void { if (!this.closed) this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`) }
  request(method: string, params: Wire, timeoutMs = 60_000): Promise<Wire> {
    if (this.closed) return Promise.reject(new Error(`${providerName(this.provider)} connection closed`))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.pending.delete(id); reject(new Error(`${providerName(this.provider)} ${method} timed out`)) }, timeoutMs) : undefined
      this.pending.set(id, { resolve, reject, timer }); this.write({ id, method, params })
    })
  }
  async initialize(): Promise<Wire> {
    const result = await this.request('initialize', { protocolVersion: 1, clientInfo: { name: 'ramu', version: '0.0.1' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    if (result.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version')
    if (this.provider === 'cursor') await this.request('authenticate', { methodId: 'cursor_login' })
    return result
  }
  async close(): Promise<void> {
    if (!this.closed) {
      this.stopping = true; this.child.stdin.end(); this.child.kill('SIGTERM')
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000)
      await this.exited; clearTimeout(timer)
    }
  }
}
const optionsOf = (config: Wire): Wire[] => (config.options ?? []).flatMap((option: Wire) => option.options ?? [option])
export function acpSessionModels(provider: AcpProvider, session: Wire): AgentModel[] {
  const config = (session.configOptions ?? []).find((c: Wire) => c.category === 'model' || c.id === 'model')
  const models: Wire[] = config ? optionsOf(config).map((m) => ({ id: m.value, name: m.name })) : (session.models?.availableModels ?? []).map((m: Wire) => ({ id: m.modelId, name: m.name }))
  const current = config?.currentValue ?? session.models?.currentModelId
  return models.map((m) => ({ provider, id: m.id, name: m.name || m.id, efforts: [], defaultEffort: null, isDefault: m.id === current }))
}
export async function acpModels(provider: AcpProvider): Promise<AgentModel[]> {
  const rpc = new AcpRpc(provider, homedir())
  rpc.onMessage = (m) => { if (m.id !== undefined && m.method) rpc.write({ id: m.id, error: { code: -32601, message: 'Model discovery cannot run tools or answer questions' } }) }
  try { await rpc.initialize(); return acpSessionModels(provider, await rpc.request('session/new', { cwd: homedir(), mcpServers: [] })) }
  finally { await rpc.close() }
}
export const createAcpRunner: AgentRunnerFactory = (scope, settings, emit, readOnly) => new AcpSession(scope, settings, emit, readOnly)
class AcpSession implements AgentRunner {
  private rpc?: AcpRpc
  private sessionId = ''
  private connection?: McpConnection
  private active?: Promise<void>
  private stopped = false
  private loading = false
  private text = ''
  private messageId = ''
  private pending = new Map<string, Wire>()
  private tools = new Set<string>()
  private session: Wire = {}
  constructor(private scope: AgentScope, private settings: AgentSettings, private emit: (event: AgentEvent, limit?: boolean) => void, private readOnly = false) {}
  setTools(connection: McpConnection): void { this.connection = connection }
  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    const provider = this.settings.provider as AcpProvider
    this.rpc = new AcpRpc(provider, this.scope.cwd)
    this.rpc.onMessage = (m) => this.handle(m)
    this.rpc.onExit = (e) => { if (!this.stopped) { this.emit({ kind: 'error', message: e.message }); this.emit({ kind: 'state', state: 'failed' }) } }
    const init = await this.rpc.initialize()
    if (resume && !init.agentCapabilities?.loadSession) throw new Error(`${providerName(provider)} does not support resuming this session. Start a new chat.`)
    this.loading = true
    try {
      this.session = await this.rpc.request(resume ? 'session/load' : 'session/new', { ...(resume ? { sessionId: resume } : {}), cwd: this.scope.cwd, mcpServers: this.connection ? [{ type: 'http', name: 'ramu', url: this.connection.url, headers: [{ name: 'Authorization', value: `Bearer ${this.connection.token}` }] }] : [] })
    } finally { this.loading = false }
    this.sessionId = resume || this.session.sessionId
    if (!this.sessionId) throw new Error('ACP runtime did not return a session ID')
    if (this.settings.model) {
      const config = (this.session.configOptions ?? []).find((c: Wire) => c.category === 'model' || c.id === 'model')
      if (!acpSessionModels(provider, this.session).some((m) => m.id === this.settings.model)) throw new Error('The selected model is unavailable in this ACP session')
      await this.rpc.request(config ? 'session/set_config_option' : 'session/set_model', config ? { sessionId: this.sessionId, configId: config.id, value: this.settings.model } : { sessionId: this.sessionId, modelId: this.settings.model })
    }
    if (this.readOnly) {
      const config = (this.session.configOptions ?? []).find((c: Wire) => c.category === 'mode' || c.id === 'mode')
      const modes = config ? optionsOf(config).map((o) => o.value) : (this.session.modes?.availableModes ?? []).map((m: Wire) => m.id)
      const mode = modes.find((id: string) => id === 'ask' || id === 'plan')
      if (!mode) throw new Error(`${providerName(provider)} does not advertise a read-only mode for background analysis`)
      await this.rpc.request(config ? 'session/set_config_option' : 'session/set_mode', config ? { sessionId: this.sessionId, configId: config.id, value: mode } : { sessionId: this.sessionId, modeId: mode })
    }
    this.emit({ kind: 'init', cwd: this.scope.cwd, model: this.settings.model || acpSessionModels(provider, this.session).find((m) => m.isDefault)?.id || `${providerName(provider)} default`, providerSessionId: this.sessionId })
    await this.send(prompt, attachments)
  }
  async send(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (this.active) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    if (!this.rpc || this.stopped) throw new Error('ACP session is not running')
    this.text = ''; this.messageId = randomUUID(); this.tools.clear()
    const content: Wire[] = [{ type: 'text', text: attachmentPrompt(prompt, attachments) }]
    for (const file of attachments.filter((f) => f.mimeType.startsWith('image/'))) content.push({ type: 'image', mimeType: file.mimeType, data: readFileSync(file.path).toString('base64') })
    this.emit({ kind: 'state', state: 'running' })
    this.active = this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt: content }, 0).then((r) => {
      this.active = undefined; this.cancelPending()
      if (!this.stopped) this.emit({ kind: 'result', isError: r.stopReason === 'refusal', text: r.stopReason || 'end_turn', costUsd: null })
    }, (e: Error) => {
      this.active = undefined; this.cancelPending()
      if (!this.stopped) this.emit({ kind: 'result', isError: true, text: e.message, costUsd: null }, /usage.?limit|rate.?limit|quota|429/i.test(e.message))
    })
  }
  async steer(): Promise<void> { throw new Error('This provider accepts follow-ups after the current turn; use Queue.') }
  async interrupt(): Promise<void> { if (this.active) { this.rpc?.write({ method: 'session/cancel', params: { sessionId: this.sessionId } }); this.cancelPending(); await this.active } }
  async stop(): Promise<void> { this.stopped = true; this.cancelPending(); await this.rpc?.close() }
  private cancelPending(): void {
    for (const [id, m] of this.pending) { this.rpc?.write({ id: m.id, result: { outcome: m.method.startsWith('cursor/') ? 'cancelled' : { outcome: 'cancelled' } } }); this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' }) }
    this.pending.clear()
  }
  private resolve(id: string, result: Wire, outcome: string): void {
    const m = this.pending.get(id)
    if (!m) throw new Error('That request is no longer pending')
    this.pending.delete(id); this.rpc!.write({ id: m.id, result })
    this.emit({ kind: 'request-resolved', requestId: id, outcome })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  replyPermission(id: string, allow: boolean): void {
    const m = this.pending.get(id)
    if (!m || m.question) throw new Error('That request is no longer pending')
    if (m.method === 'cursor/create_plan') return this.resolve(id, { outcome: allow ? 'accepted' : 'rejected' }, allow ? 'allowed' : 'denied')
    const option = (m.params.options ?? []).find((o: Wire) => o.kind === (allow ? 'allow_once' : 'reject_once')) ?? (m.params.options ?? []).find((o: Wire) => o.kind === (allow ? 'allow_always' : 'reject_always'))
    this.resolve(id, { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } }, allow ? 'allowed' : 'denied')
  }
  replyQuestion(id: string, answers: Record<string, string>): void {
    const m = this.pending.get(id)
    if (!m?.question) throw new Error('That request is no longer pending')
    if (m.method === 'cursor/ask_question') {
      const selected = m.params.questions.map((q: Wire) => ({ questionId: q.id, selectedOptionIds: (q.options ?? []).filter((o: Wire) => answers[q.prompt] === o.label || (q.allowMultiple && (answers[q.prompt] || '').split(', ').includes(o.label))).map((o: Wire) => o.id) }))
      if (selected.some((a: Wire) => !a.selectedOptionIds.length)) throw new Error('Choose one of the advertised answers')
      this.resolve(id, { outcome: 'answered', answers: selected }, 'answered')
    } else {
      const option = m.params.options.find((o: Wire) => o.name === answers[m.params.toolCall.title])
      if (!option) throw new Error('Choose one of the advertised answers')
      this.resolve(id, { outcome: { outcome: 'selected', optionId: option.optionId } }, 'answered')
    }
  }
  private handle(m: Wire): void {
    if (this.stopped || !m.method) return
    const p = m.params ?? {}
    if (m.method === 'session/update') {
      if (this.loading || p.sessionId !== this.sessionId) return
      const u = p.update ?? {}
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') { this.text += u.content.text; this.emit({ kind: 'text', text: this.text, messageId: this.messageId }) }
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        const id = u.toolCallId
        if (!this.tools.has(id)) { this.tools.add(id); this.emit({ kind: 'tool-use', toolUseId: id, name: u.kind || 'Tool', summary: u.title || '' }) }
        if (u.status === 'completed' || u.status === 'failed') this.emit({ kind: 'tool-result', toolUseId: id, isError: u.status === 'failed', summary: (u.content ?? []).map((c: Wire) => c.content?.text || c.path || '').join('\n') || u.title || '' })
      }
      return
    }
    if (m.id === undefined) return
    if (m.method === 'session/request_permission' || m.method === 'cursor/ask_question' || m.method === 'cursor/create_plan') {
      const id = String(m.id)
      const interaction = m.method === 'session/request_permission' && this.settings.provider === 'antigravity' && String(p.toolCall?.toolCallId).startsWith('interaction_')
      const question = interaction || m.method === 'cursor/ask_question'
      this.pending.set(id, { ...m, question })
      if (question && this.readOnly) { this.cancelPending(); this.rpc?.write({ method: 'session/cancel', params: { sessionId: this.sessionId } }); return }
      if (question) {
        this.emit({ kind: 'question', requestId: id, questions: interaction ? [{ question: p.toolCall.title, header: 'Antigravity', multiSelect: false, options: (p.options ?? []).map((o: Wire) => ({ label: o.name, description: '' })) }] : (p.questions ?? []).map((q: Wire) => ({ question: q.prompt, header: p.title || 'Cursor', multiSelect: !!q.allowMultiple, options: (q.options ?? []).map((o: Wire) => ({ label: o.label, description: '' })) })) })
      } else if (this.readOnly) { this.replyPermission(id, false); return }
      else if (m.method !== 'cursor/create_plan' && (this.settings.access === 'full' || (this.settings.access === 'edits' && p.toolCall?.kind === 'edit'))) { this.replyPermission(id, true); return }
      else this.emit({ kind: 'permission-request', requestId: id, toolName: p.toolCall?.kind || 'Plan', title: p.toolCall?.title || p.name || 'Approve plan?', detail: p.plan || JSON.stringify(p.toolCall?.rawInput ?? {}) })
      this.emit({ kind: 'state', state: 'needs-input' }); return
    }
    this.rpc?.write({ id: m.id, error: { code: -32601, message: `Unsupported client method: ${m.method}` } })
  }
}
