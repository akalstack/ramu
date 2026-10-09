import { attachmentPrompt } from './attachments'
// Codex's local app-server protocol, using the user's existing CLI login.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { providerBinary } from './providerBinaries'
import { createInterface } from 'node:readline'
import type { Attachment, AgentEvent, AgentModel, AgentScope, AgentSettings, McpConnection } from '../shared/types'

// Wire messages are validated by the app-server. Only the consumed fields cross into our domain.
type Wire = Record<string, any>
export class CodexRpc {
  private readonly process: ChildProcessWithoutNullStreams
  private nextId = 0
  private closed = false
  private readonly waiting = new Map<number, { resolve: (value: Wire) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  onMessage: (message: Wire) => void = () => {}
  onExit: (error: Error) => void = () => {}
  readonly exited: Promise<void>

  constructor(connection?: McpConnection) {
    this.process = spawn(providerBinary('codex'), ['app-server', '--stdio', ...(connection ? ['-c', `mcp_servers.ramu.url=${JSON.stringify(connection.url)}`, '-c', 'mcp_servers.ramu.bearer_token_env_var="RAMU_MCP_TOKEN"'] : [])], { stdio: 'pipe', env: { ...process.env, ...(connection ? { RAMU_MCP_TOKEN: connection.token } : {}) } })
    this.process.stderr.resume()
    const lines = createInterface({ input: this.process.stdout })
    lines.on('line', (line) => {
      let m: Wire
      try { m = JSON.parse(line) } catch { return }
      const pending = typeof m.id === 'number' && !m.method ? this.waiting.get(m.id) : undefined
      if (pending) {
        this.waiting.delete(m.id)
        clearTimeout(pending.timer)
        if (m.error) pending.reject(new Error(m.error.message || 'Codex request failed'))
        else pending.resolve(m.result ?? {})
      } else this.onMessage(m)
    })
    this.exited = new Promise((resolve) => {
      const finish = (error: Error) => {
        for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(error) }
        this.waiting.clear()
        if (!this.closed) this.onExit(error)
        lines.close()
        resolve()
      }
      this.process.once('error', (error) => finish(new Error(`Cannot start Codex. Install the Codex CLI and sign in first. ${error.message}`)))
      this.process.once('exit', (code) => finish(new Error(`Codex app-server exited (${code ?? 'signal'})`)))
    })
    this.process.stdin.on('error', () => {})
  }
  write(message: Wire): void {
    if (!this.closed) this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }
  request(method: string, params: Wire): Promise<Wire> {
    if (this.closed) return Promise.reject(new Error('Codex connection closed'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`Codex ${method} timed out`)) }, 30_000)
      this.waiting.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }
  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'ramu', title: 'Ramu', version: '0.0.1' } })
    this.write({ method: 'initialized', params: {} })
  }
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.process.stdin.end()
      this.process.kill('SIGTERM')
      const timer = setTimeout(() => this.process.kill('SIGKILL'), 2000)
      await this.exited
      clearTimeout(timer)
    } else await this.exited
  }
}

export async function codexModels(): Promise<AgentModel[]> {
  const rpc = new CodexRpc()
  try {
    await rpc.initialize()
    const models: AgentModel[] = []
    let cursor: string | null = null
    do {
      const result = await rpc.request('model/list', { cursor, limit: 100 })
      for (const m of result.data ?? []) {
        if (!m.hidden) models.push({ provider: 'codex', id: m.model, name: m.displayName, efforts: (m.supportedReasoningEfforts ?? []).map((e: Wire) => e.reasoningEffort), defaultEffort: m.defaultReasoningEffort, isDefault: m.isDefault, serviceTiers: (m.serviceTiers ?? []).map((tier: Wire) => tier.id).concat(m.additionalSpeedTiers ?? []) })
      }
      cursor = result.nextCursor ?? null
    } while (cursor)
    return models
  } finally { await rpc.close() }
}

// Compatibility aliases for existing Codex factories.
export type { AgentRunner as CodexRunner, AgentRunnerFactory as CodexFactory } from './agentRunner'
import type { AgentRunner as CodexRunner, AgentRunnerFactory as CodexFactory } from './agentRunner'

export const createCodexRunner: CodexFactory = (scope, settings, emit, readOnly) => new CodexSession(scope, settings, emit, readOnly)
class CodexSession implements CodexRunner {
  private rpc!: CodexRpc
  private connection?: McpConnection
  private threadId = ''
  private turnId = ''
  private readonly completedTurns = new Set<string>()
  private readonly compactedItems = new Set<string>()
  private modernCompactionTurn = ''
  private legacyCompactionTurn = ''
  private stopped = false
  private limit = false
  private readonly messages = new Map<string, string>()
  private readonly pending = new Map<string, { id: number | string; questions?: Wire[]; permissions?: Wire }>()
  constructor(private readonly scope: AgentScope, private readonly settings: AgentSettings, private readonly emit: (event: AgentEvent, usageLimit?: boolean) => void, private readonly readOnly = false) {

  }
  setTools(connection: McpConnection): void { this.connection = connection }
  private policies() {
    if (this.readOnly) return { approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } }
    return this.settings.access === 'full'
      ? { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }
      : this.settings.access === 'ask'
        ? { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly' } }
        : { approvalPolicy: this.settings.access === 'auto' ? 'on-request' : 'untrusted', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.scope.cwd, ...this.scope.additionalDirs], networkAccess: false } }
  }
  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    this.rpc = new CodexRpc(this.connection)
    this.rpc.onMessage = (m) => this.handle(m)
    this.rpc.onExit = (e) => { if (!this.stopped) { this.emit({ kind: 'error', message: e.message }); this.emit({ kind: 'state', state: 'failed' }) } }
    await this.rpc.initialize()
    const full = this.settings.access === 'full'
    const result = await this.rpc.request(resume ? 'thread/resume' : 'thread/start', {
      ...(resume ? { threadId: resume } : {}), cwd: this.scope.cwd,
      ...(this.settings.model ? { model: this.settings.model } : {}),
      serviceTier: this.settings.serviceTier === 'fast' ? 'fast' : 'default',
      ...(this.settings.serviceTier === 'fast' ? { config: { 'features.fast_mode': true } } : {}),
      approvalPolicy: this.policies().approvalPolicy, sandbox: this.readOnly || this.settings.access === 'ask' ? 'read-only' : full ? 'danger-full-access' : 'workspace-write',
    })
    this.threadId = result.thread.id
    this.emit({ kind: 'init', model: result.model || this.settings.model || 'Codex default', cwd: this.scope.cwd, providerSessionId: this.threadId })
    await this.send(prompt, attachments)
  }
  async send(prompt: string, attachments?: Attachment[]): Promise<void> {
    if (this.turnId) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    this.limit = false
    const result = await this.rpc.request('turn/start', {
      threadId: this.threadId, input: [{ type: 'text', text: attachmentPrompt(prompt, attachments) }, ...(attachments ?? []).filter((file) => file.mimeType.startsWith('image/')).map((file) => ({ type: 'localImage', path: file.path }))], cwd: this.scope.cwd,
      ...this.policies(), ...(this.settings.model ? { model: this.settings.model } : {}),
      ...(this.settings.effort ? { effort: this.settings.effort } : {}),
      serviceTier: this.settings.serviceTier === 'fast' ? 'fast' : 'default',
    })
    this.turnId = this.completedTurns.has(result.turn.id) ? '' : result.turn.id
  }
  async steer(prompt: string, attachments?: Attachment[]): Promise<void> {
    if (!this.turnId) throw new Error('The turn has finished. Send the message again.')
    await this.rpc.request('turn/steer', { threadId: this.threadId, expectedTurnId: this.turnId, input: [{ type: 'text', text: attachmentPrompt(prompt, attachments) }, ...(attachments ?? []).filter((file) => file.mimeType.startsWith('image/')).map((file) => ({ type: 'localImage', path: file.path }))] })
  }
  async interrupt(): Promise<void> {
    if (this.turnId) await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
  }
  async stop(): Promise<void> {
    this.stopped = true
    for (const [id] of this.pending) this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
    this.pending.clear()
    await this.rpc?.close()
  }
  replyPermission(id: string, allow: boolean): void {
    const req = this.pending.get(id)
    if (!req || req.questions) throw new Error('That request is no longer pending')
    this.pending.delete(id)
    this.rpc.write({ id: req.id, result: req.permissions ? { permissions: allow ? req.permissions : {}, scope: 'turn' } : { decision: allow ? 'accept' : 'decline' } })
    this.emit({ kind: 'request-resolved', requestId: id, outcome: allow ? 'allowed' : 'denied' })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  replyQuestion(id: string, answers: Record<string, string>): void {
    const req = this.pending.get(id)
    if (!req?.questions) throw new Error('That request is no longer pending')
    this.pending.delete(id)
    this.rpc.write({ id: req.id, result: { answers: Object.fromEntries(req.questions.map((q) => [q.id, { answers: [answers[q.question] || ''] }])) } })
    this.emit({ kind: 'request-resolved', requestId: id, outcome: 'answered' })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  private handle(m: Wire): void {
    if (this.stopped || !m.method) return
    const p = m.params ?? {}
    if (p.threadId && this.threadId && p.threadId !== this.threadId) return
    if (m.id !== undefined) {
      const id = String(m.id)
      if (m.method === 'item/commandExecution/requestApproval' || m.method === 'item/fileChange/requestApproval') {
        this.pending.set(id, { id: m.id })
        this.emit({ kind: 'permission-request', requestId: id, toolName: m.method.includes('commandExecution') ? 'Bash' : 'Edit', title: m.method.includes('commandExecution') ? 'Allow command?' : 'Allow file changes?', detail: [p.command, p.reason].filter(Boolean).join('\n') })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else if (m.method === 'item/permissions/requestApproval') {
        this.pending.set(id, { id: m.id, permissions: p.permissions })
        this.emit({ kind: 'permission-request', requestId: id, toolName: 'Permissions', title: 'Allow additional access?', detail: [p.reason, JSON.stringify(p.permissions, null, 2)].filter(Boolean).join('\n') })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else if (m.method === 'item/tool/requestUserInput') {
        this.pending.set(id, { id: m.id, questions: p.questions })
        this.emit({ kind: 'question', requestId: id, questions: (p.questions ?? []).map((q: Wire) => ({ question: q.question, header: q.header, multiSelect: false, options: q.options ?? [] })) })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else this.rpc.write({ id: m.id, error: { code: -32601, message: `Ramu does not support ${m.method}` } })
      return
    }
    if (m.method === 'turn/started') { this.turnId = p.turn.id; this.emit({ kind: 'state', state: 'running' }) }
    if (m.method === 'thread/compacted' && p.turnId !== this.modernCompactionTurn && p.turnId !== this.legacyCompactionTurn) {
      this.legacyCompactionTurn = p.turnId
      this.emit({ kind: 'compaction', state: 'completed' })
    }
    if (m.method === 'error') {
      const info = JSON.stringify(p.error?.codexErrorInfo ?? '')
      this.limit ||= /usageLimitExceeded|rateLimitExceeded/i.test(info)
      if (!p.willRetry) this.emit({ kind: 'error', message: p.error?.message || 'Codex failed' }, this.limit)
    }
    if (m.method === 'item/agentMessage/delta') {
      const text = (this.messages.get(p.itemId) || '') + (p.delta || '')
      this.messages.set(p.itemId, text)
      this.emit({ kind: 'text', text, messageId: p.itemId })
    }
    if (m.method === 'item/started' || m.method === 'item/completed') {
      const item = p.item ?? {}
      const complete = m.method === 'item/completed'
      if (item.type === 'contextCompaction') {
        if (!complete) this.emit({ kind: 'compaction', state: 'started' })
        else if (!this.compactedItems.has(item.id)) {
          this.compactedItems.add(item.id)
          if (this.compactedItems.size > 100) this.compactedItems.delete(this.compactedItems.values().next().value!)
          this.modernCompactionTurn = p.turnId || this.turnId
          if (this.modernCompactionTurn !== this.legacyCompactionTurn) this.emit({ kind: 'compaction', state: 'completed' })
        }
      }
      if (item.type === 'agentMessage' && complete && item.text) this.emit({ kind: 'text', text: item.text, messageId: item.id })
      // Web searches, page opens and image views are tool calls too; without them a research turn looks like silence.
      const extra = toolOfOtherItem(item)
      if (extra) {
        if (!complete) this.emit({ kind: 'tool-use', toolUseId: item.id, name: extra.name, summary: extra.summary })
        else this.emit({ kind: 'tool-result', toolUseId: item.id, isError: item.status === 'failed', summary: extra.result })
      }
      if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall') {
        if (!complete) this.emit({ kind: 'tool-use', toolUseId: item.id, name: item.type === 'commandExecution' ? 'Bash' : item.type === 'fileChange' ? 'Edit' : item.tool || 'Tool', summary: item.command || (item.changes ?? []).map((c: Wire) => c.path).join(', ') || item.server || '' })
        else this.emit({ kind: 'tool-result', toolUseId: item.id, isError: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0), summary: item.aggregatedOutput || JSON.stringify(item.changes ?? item.result ?? '') })
      }
    }
    if (m.method === 'serverRequest/resolved') {
      const id = String(p.requestId)
      if (this.pending.delete(id)) this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
    }
    if (m.method === 'turn/completed') {
      this.completedTurns.add(p.turn.id)
      if (this.completedTurns.size > 100) this.completedTurns.delete(this.completedTurns.values().next().value!)
      this.turnId = ''
      const error = p.turn.error
      this.limit ||= /usageLimitExceeded|rateLimitExceeded/i.test(JSON.stringify(error?.codexErrorInfo ?? ''))
      this.emit({ kind: 'result', isError: p.turn.status === 'failed', text: error?.message || p.turn.status, costUsd: null }, this.limit)
      // AgentService owns the state transition and any fallback.
    }
  }
}

/** Codex items that are tool calls but not commands, edits or MCP calls. */
export function toolOfOtherItem(item: Wire): { name: string; summary: string; result: string } | null {
  if (item.type === 'webSearch') {
    const action = item.action ?? {}
    if (action.type === 'openPage') return { name: 'WebFetch', summary: String(action.url ?? item.query ?? ''), result: String(action.url ?? 'Opened page') }
    if (action.type === 'findInPage') return { name: 'WebFetch', summary: `${action.pattern ?? ''} in ${action.url ?? 'page'}`.trim(), result: String(action.url ?? 'Searched in page') }
    const query = String(action.query ?? item.query ?? '')
    return { name: 'WebSearch', summary: query, result: query ? `Searched: ${query}` : 'Searched the web' }
  }
  if (item.type === 'imageView') return { name: 'Read', summary: String(item.path ?? ''), result: String(item.path ?? 'Viewed image') }
  if (item.type === 'dynamicToolCall') return { name: String(item.tool ?? 'Tool'), summary: item.arguments ? JSON.stringify(item.arguments).slice(0, 200) : '', result: JSON.stringify(item.contentItems ?? item.success ?? '').slice(0, 2000) }
  if (item.type === 'collabAgentToolCall') return { name: 'Agent', summary: String(item.tool ?? item.prompt ?? ''), result: String(item.status ?? '') }
  return null
}
