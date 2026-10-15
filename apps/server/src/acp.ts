// Native OpenCode, Cursor and Google Antigravity ACP runtimes; JSON-RPC 2.0, newline framing.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { createInterface } from 'node:readline'
import { AcpEvents } from './acpEvents'
import type {
  AgentEvent,
  AgentModel,
  ReasoningEffort,
  AgentScope,
  AgentSettings,
  Attachment,
  McpConnection,
} from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers'
import { attachmentPrompt } from './attachments'
import { isLimitMessage, isLimitReply, limitResetsAt } from './usageLimit'
import type { AgentRunner, AgentRunnerFactory } from './agentRunner'

type Wire = Record<string, any>
type AcpProvider = 'cursor' | 'antigravity' | 'opencode'
export function acpCommand(provider: AcpProvider): { command: string; args: string[] } {
  return {
    command: providerBinary(provider),
    args: provider === 'cursor' || provider === 'opencode' ? ['acp'] : process.platform === 'linux' ? ['--uid='] : [],
  }
}
/** The runtime cannot continue the saved session (no resume support, or it no longer has it). The chat can still go on from its transcript. */
export class AcpResumeUnavailable extends Error {}
export class AcpRpc {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private closed = false
  private stopping = false
  private pending = new Map<
    number,
    { resolve: (r: Wire) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }
  >()
  readonly exited: Promise<void>
  onMessage: (message: Wire) => void = () => {}
  onExit: (error: Error) => void = () => {}
  constructor(
    private provider: AcpProvider,
    cwd: string,
    accountId?: string,
    extraEnv: Record<string, string> = {},
  ) {
    const { command, args } = acpCommand(provider)
    this.child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      env: { ...providerEnvironment(provider, undefined, accountId), ...extraEnv },
    })
    this.child.stderr.resume()
    this.child.stdin.on('error', () => {})
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      let m: Wire
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      if (!m.method && typeof m.id === 'number') {
        const pending = this.pending.get(m.id)
        if (!pending) return
        this.pending.delete(m.id)
        clearTimeout(pending.timer)
        // Antigravity has no login command; point at Ramu's own sign-in instead of the runtime's settings file.
        if (m.error)
          pending.reject(
            Object.assign(
              new Error(
                provider === 'antigravity' && /authentication required/i.test(m.error.message ?? '')
                  ? 'Sign in to Antigravity first: Settings → Providers → Antigravity → Login.'
                  : m.error.message || `${providerName(provider)} request failed`,
              ),
              { rpc: true },
            ),
          )
        else pending.resolve(m.result ?? {})
      } else this.onMessage(m)
    })
    this.exited = new Promise((resolve) => {
      const finish = (error: Error) => {
        if (this.closed) return
        this.closed = true
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer)
          entry.reject(error)
        }
        this.pending.clear()
        lines.close()
        if (!this.stopping) this.onExit(error)
        resolve()
      }
      this.child.once('error', (e) =>
        finish(
          new Error(
            `Cannot start ${providerName(provider)}. Install and sign in to its ${provider === 'cursor' ? 'CLI (agent login)' : 'official ACP runtime'} first. ${e.message}`,
          ),
        ),
      )
      this.child.once('exit', (code) =>
        finish(new Error(`${providerName(provider)} ACP runtime exited (${code ?? 'signal'})`)),
      )
    })
  }
  write(message: Wire): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }
  request(method: string, params: Wire, timeoutMs = 60_000): Promise<Wire> {
    if (this.closed) return Promise.reject(new Error(`${providerName(this.provider)} connection closed`))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`${providerName(this.provider)} ${method} timed out`))
          }, timeoutMs)
        : undefined
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }
  async initialize(): Promise<Wire> {
    const result = await this.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'ramu', version: '0.0.1' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        ...(this.provider === 'opencode' ? { _meta: { 'opencode/child-session-updates': true } } : {}),
      },
    })
    if (result.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version')
    if (this.provider === 'cursor') await this.request('authenticate', { methodId: 'cursor_login' })
    return result
  }
  async close(): Promise<void> {
    if (!this.closed) {
      this.stopping = true
      this.child.stdin.end()
      this.child.kill('SIGTERM')
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000)
      await this.exited
      clearTimeout(timer)
    }
  }
}
const EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const effortConfig = (session: Wire): Wire | undefined =>
  (session.configOptions ?? []).find((c: Wire) => c.category === 'thought_level')
const optionsOf = (config: Wire): Wire[] => (config.options ?? []).flatMap((option: Wire) => option.options ?? [option])
export function acpSessionModels(provider: AcpProvider, session: Wire): AgentModel[] {
  const config = (session.configOptions ?? []).find((c: Wire) => c.category === 'model' || c.id === 'model')
  const models: Wire[] = config
    ? optionsOf(config).map((m) => ({ id: m.value, name: m.name }))
    : (session.models?.availableModels ?? []).map((m: Wire) => ({ id: m.modelId, name: m.name }))
  const current = config?.currentValue ?? session.models?.currentModelId
  // ACP exposes reasoning as one session-wide option; only levels Ramu understands can be offered.
  const level = effortConfig(session)
  const efforts = level
    ? optionsOf(level)
        .map((o) => o.value as ReasoningEffort)
        .filter((value) => EFFORTS.includes(value))
    : []
  const defaultEffort = efforts.includes(level?.currentValue) ? (level!.currentValue as ReasoningEffort) : null
  return models.map((m) => ({
    provider,
    id: m.id,
    name: m.name || m.id,
    efforts,
    defaultEffort,
    isDefault: m.id === current,
  }))
}
export async function acpModels(provider: AcpProvider, accountId?: string): Promise<AgentModel[]> {
  const rpc = new AcpRpc(provider, homedir(), accountId)
  rpc.onMessage = (m) => {
    if (m.id !== undefined && m.method)
      rpc.write({ id: m.id, error: { code: -32601, message: 'Model discovery cannot run tools or answer questions' } })
  }
  try {
    await rpc.initialize()
    return acpSessionModels(provider, await rpc.request('session/new', { cwd: homedir(), mcpServers: [] }))
  } finally {
    await rpc.close()
  }
}
/** Answers one question on a throwaway fork of an existing session, with every tool refused. Needs the runtime's `fork` capability. */
export async function acpAside({
  provider,
  accountId,
  cwd,
  sessionId,
  prompt,
  timeoutMs = 120_000,
  signal,
}: {
  provider: AcpProvider
  accountId?: string
  cwd: string
  sessionId: string
  prompt: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<string> {
  const rpc = new AcpRpc(provider, cwd, accountId)
  let forked = '',
    text = ''
  rpc.onMessage = (m) => {
    if (
      m.method === 'session/update' &&
      m.params?.sessionId === forked &&
      m.params.update?.sessionUpdate === 'agent_message_chunk' &&
      m.params.update.content?.type === 'text'
    )
      text += String(m.params.update.content.text ?? '')
    else if (m.id !== undefined && m.method === 'session/request_permission') {
      const option =
        (m.params.options ?? []).find((o: Wire) => o.kind === 'reject_once') ??
        (m.params.options ?? []).find((o: Wire) => o.kind === 'reject_always')
      rpc.write({
        id: m.id,
        result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } },
      })
    } else if (m.id !== undefined && m.method)
      rpc.write({ id: m.id, error: { code: -32601, message: 'A side question cannot use tools or ask questions' } })
  }
  const stop = () => void rpc.close()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const init = await rpc.initialize()
    if (!init.agentCapabilities?.sessionCapabilities?.fork)
      throw new Error(`${providerName(provider)} cannot fork sessions`)
    forked = (await rpc.request('session/fork', { sessionId, cwd, mcpServers: [] })).sessionId
    if (!forked) throw new Error('ACP runtime did not return a forked session')
    await rpc.request('session/prompt', { sessionId: forked, prompt: [{ type: 'text', text: prompt }] }, timeoutMs)
    return text.trim()
  } finally {
    signal?.removeEventListener('abort', stop)
    await rpc.close()
  }
}
/**
 * OpenCode reads inline config from the environment. Denying its `task` permission removes the native sub-agent tool,
 * so every sub-agent goes through `ramu_agent`. Existing inline config is kept.
 */
export function openCodeConfigEnv(
  connection: McpConnection | undefined,
  existing = process.env.OPENCODE_CONFIG_CONTENT,
): Record<string, string> {
  if (connection?.nativeSubagents !== false) return {}
  let config: Wire = {}
  try {
    config = existing ? JSON.parse(existing) : {}
  } catch {
    return {}
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const permission =
    config.permission && typeof config.permission === 'object' && !Array.isArray(config.permission)
      ? config.permission
      : {}
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, permission: { ...permission, task: 'deny' } }) }
}
/** Runs the runtime's own sign-in. Antigravity opens the browser itself and stores the credentials in its home. */
export async function acpSignIn(
  provider: AcpProvider,
  methodId: string,
  accountId = 'default',
  timeoutMs = 5 * 60_000,
): Promise<void> {
  const rpc = new AcpRpc(provider, homedir(), accountId)
  rpc.onMessage = (m) => {
    if (m.id !== undefined && m.method)
      rpc.write({ id: m.id, error: { code: -32601, message: 'Sign-in cannot run tools' } })
  }
  try {
    const init = await rpc.initialize()
    if (!(init.authMethods ?? []).some((method: Wire) => method.id === methodId))
      throw new Error(`${providerName(provider)} does not offer this sign-in method`)
    await rpc.request('authenticate', { methodId }, timeoutMs)
  } finally {
    await rpc.close()
  }
}
export const createAcpRunner: AgentRunnerFactory = (scope, settings, emit, readOnly) =>
  new AcpSession(scope, settings, emit, readOnly)
class AcpSession implements AgentRunner {
  private rpc?: AcpRpc
  private sessionId = ''
  private connection?: McpConnection
  private active?: Promise<void>
  private stopped = false
  /** True while a cancelled turn is being replaced by a steering message, so its end is not reported as a finished turn. */
  private steering = false
  private turnText = new Map<string, string>()
  private turnTools = 0
  private seenTools = new Set<string>()
  readonly canSteer = true
  readonly steerInterrupts = true
  private loading = false
  private events: AcpEvents
  private pending = new Map<string, Wire>()
  private session: Wire = {}
  private prompts?: { image?: boolean }
  constructor(
    private scope: AgentScope,
    private settings: AgentSettings,
    private emit: (event: AgentEvent, limit?: boolean) => void,
    private readOnly = false,
  ) {
    this.events = new AcpEvents(false, settings.provider === 'antigravity' ? ['invoke_subagent'] : ['task', 'subagent'])
  }
  setTools(connection: McpConnection): void {
    this.connection = connection
  }
  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    const provider = this.settings.provider as AcpProvider
    this.rpc = new AcpRpc(
      provider,
      this.scope.cwd,
      this.settings.accountId ?? 'default',
      provider === 'opencode' ? openCodeConfigEnv(this.connection) : {},
    )
    this.rpc.onMessage = (m) => this.handle(m)
    this.rpc.onExit = (e) => {
      if (!this.stopped) {
        this.emit({ kind: 'error', message: e.message })
        this.emit({ kind: 'state', state: 'failed' })
      }
    }
    const init = await this.rpc.initialize()
    const capabilities = init.agentCapabilities ?? {}
    this.prompts = capabilities.promptCapabilities
    // `session/resume` continues without replaying history; `session/load` is the older way. With neither, the caller continues from the transcript.
    const method = !resume
      ? 'session/new'
      : capabilities.sessionCapabilities?.resume
        ? 'session/resume'
        : capabilities.loadSession
          ? 'session/load'
          : null
    if (!method)
      throw new AcpResumeUnavailable(
        `${providerName(provider)} does not support resuming this session. Start a new chat.`,
      )
    // HTTP MCP is optional in ACP. A runtime that lists its MCP support without HTTP cannot reach Ramu's tools, so say so instead of losing them silently.
    const mcp = capabilities.mcpCapabilities
    const tools = this.connection && !(mcp && mcp.http !== true) ? this.connection : undefined
    if (this.connection && !tools)
      this.emit({
        kind: 'error',
        message: `${providerName(provider)} cannot connect to Ramu's tools over HTTP, so questions, helpers and advice are unavailable in this chat.`,
      })
    this.loading = true
    try {
      this.session = await this.rpc.request(method, {
        ...(resume ? { sessionId: resume } : {}),
        cwd: this.scope.cwd,
        additionalDirectories: this.scope.additionalDirs,
        mcpServers: tools
          ? [
              {
                type: 'http',
                name: 'ramu',
                url: tools.url,
                headers: [{ name: 'Authorization', value: `Bearer ${tools.token}` }],
              },
            ]
          : [],
      })
    } catch (e) {
      // The runtime answered but no longer has the session; a crash or timeout is a different failure and stays one.
      if (resume && (e as { rpc?: boolean }).rpc)
        throw new AcpResumeUnavailable(`${providerName(provider)} no longer has this session: ${(e as Error).message}`)
      throw e
    } finally {
      this.loading = false
    }
    this.sessionId = resume || this.session.sessionId
    if (!this.sessionId) throw new Error('ACP runtime did not return a session ID')
    if (this.settings.model) {
      const config = (this.session.configOptions ?? []).find((c: Wire) => c.category === 'model' || c.id === 'model')
      if (!acpSessionModels(provider, this.session).some((m) => m.id === this.settings.model))
        throw new Error('The selected model is unavailable in this ACP session')
      const changed = await this.rpc.request(
        config ? 'session/set_config_option' : 'session/set_model',
        config
          ? { sessionId: this.sessionId, configId: config.id, value: this.settings.model }
          : { sessionId: this.sessionId, modelId: this.settings.model },
      )
      if (Array.isArray(changed.configOptions)) this.session = { ...this.session, configOptions: changed.configOptions }
    }
    if (this.settings.effort) {
      // Re-read after the model switch: the runtime may expose different levels per model.
      const level = effortConfig(this.session)
      if (level && optionsOf(level).some((o) => o.value === this.settings.effort))
        await this.rpc.request('session/set_config_option', {
          sessionId: this.sessionId,
          configId: level.id,
          value: this.settings.effort,
        })
    }
    if (this.readOnly) {
      const config = (this.session.configOptions ?? []).find((c: Wire) => c.category === 'mode' || c.id === 'mode')
      const modes = config
        ? optionsOf(config).map((o) => o.value)
        : (this.session.modes?.availableModes ?? []).map((m: Wire) => m.id)
      const mode = modes.find((id: string) => id === 'ask' || id === 'plan')
      if (!mode)
        throw new Error(`${providerName(provider)} does not advertise a read-only mode for background analysis`)
      await this.rpc.request(
        config ? 'session/set_config_option' : 'session/set_mode',
        config
          ? { sessionId: this.sessionId, configId: config.id, value: mode }
          : { sessionId: this.sessionId, modeId: mode },
      )
    }
    this.emit({
      kind: 'init',
      cwd: this.scope.cwd,
      model:
        this.settings.model ||
        acpSessionModels(provider, this.session).find((m) => m.isDefault)?.id ||
        `${providerName(provider)} default`,
      providerSessionId: this.sessionId,
    })
    await this.send(prompt, attachments)
  }
  async send(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (this.active) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    if (!this.rpc || this.stopped) throw new Error('ACP session is not running')
    this.events.beginTurn()
    this.turnText.clear()
    this.turnTools = 0
    this.seenTools.clear()
    // Image blocks are optional in ACP. A runtime that lists its prompt support without images gets the saved path in the text instead.
    const images = attachments.filter((f) => f.mimeType.startsWith('image/'))
    const inline = !this.prompts || this.prompts.image === true
    const unsent = inline
      ? []
      : images.map(
          (file) =>
            `Image attachment ${JSON.stringify(file.name)} is saved at ${JSON.stringify(file.path)}. This runtime cannot receive images directly; inspect it with your file tools if you can.`,
        )
    const content: Wire[] = [{ type: 'text', text: [attachmentPrompt(prompt, attachments), ...unsent].join('\n\n') }]
    if (inline)
      for (const file of images)
        content.push({ type: 'image', mimeType: file.mimeType, data: readFileSync(file.path).toString('base64') })
    this.emit({ kind: 'state', state: 'running' })
    this.active = this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt: content }, 0).then(
      (r) => {
        this.active = undefined
        this.cancelPending()
        if (this.stopped || this.steering) return
        // A runtime may report an exhausted quota as an ordinary reply, or as a refusal.
        const reply = [...this.turnText.values()].join('\n').trim()
        const limited = isLimitReply(reply, this.turnTools) || (r.stopReason === 'refusal' && isLimitMessage(reply))
        if (limited) this.markLimited(reply)
        this.emit(
          {
            kind: 'result',
            isError: limited || r.stopReason === 'refusal',
            text: limited ? reply : r.stopReason || 'end_turn',
            costUsd: null,
          },
          limited,
        )
      },
      (e: Error) => {
        this.active = undefined
        this.cancelPending()
        if (this.stopped || this.steering) return
        if (isLimitMessage(e.message)) this.markLimited(e.message)
        this.emit({ kind: 'result', isError: true, text: e.message, costUsd: null }, isLimitMessage(e.message))
      },
    )
  }
  /** ACP has no way to add input to a running turn, so steering cancels it and continues the same session with the new message. */
  async steer(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.active || !this.rpc || this.stopped) throw new Error('There is no running turn to steer')
    this.steering = true
    try {
      this.rpc.write({ method: 'session/cancel', params: { sessionId: this.sessionId } })
      this.cancelPending()
      await this.active
    } finally {
      this.steering = false
    }
    await this.send(prompt, attachments)
  }
  async interrupt(): Promise<void> {
    if (this.active) {
      this.rpc?.write({ method: 'session/cancel', params: { sessionId: this.sessionId } })
      this.cancelPending()
      await this.active
    }
  }
  async stop(): Promise<void> {
    this.stopped = true
    this.cancelPending()
    await this.rpc?.close()
  }
  /** No usage API exists for these runtimes, so a limit response is recorded as a reading and routing avoids the provider until it lifts. */
  private markLimited(text: string): void {
    const resetsAt = limitResetsAt(text)
    const accountId =
      this.settings.accountId && this.settings.accountId !== 'default' ? { accountId: this.settings.accountId } : {}
    this.emit({
      kind: 'usage',
      readings: [
        {
          provider: this.settings.provider,
          ...accountId,
          window: 'five_hour',
          usedPercent: 100,
          status: 'limited',
          ...(resetsAt ? { resetsAt } : {}),
          updatedAt: Date.now(),
        },
      ],
    })
  }
  private cancelPending(): void {
    for (const [id, m] of this.pending) {
      this.rpc?.write({
        id: m.id,
        result: { outcome: m.method.startsWith('cursor/') ? 'cancelled' : { outcome: 'cancelled' } },
      })
      this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
    }
    this.pending.clear()
  }
  private resolve(id: string, result: Wire, outcome: string): void {
    const m = this.pending.get(id)
    if (!m) throw new Error('That request is no longer pending')
    this.pending.delete(id)
    this.rpc!.write({ id: m.id, result })
    this.emit({ kind: 'request-resolved', requestId: id, outcome })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  replyPermission(id: string, allow: boolean): void {
    const m = this.pending.get(id)
    if (!m || m.question) throw new Error('That request is no longer pending')
    if (m.method === 'cursor/create_plan')
      return this.resolve(id, { outcome: allow ? 'accepted' : 'rejected' }, allow ? 'allowed' : 'denied')
    const option =
      (m.params.options ?? []).find((o: Wire) => o.kind === (allow ? 'allow_once' : 'reject_once')) ??
      (m.params.options ?? []).find((o: Wire) => o.kind === (allow ? 'allow_always' : 'reject_always'))
    this.resolve(
      id,
      { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } },
      allow ? 'allowed' : 'denied',
    )
  }
  replyQuestion(id: string, answers: Record<string, string>): void {
    const m = this.pending.get(id)
    if (!m?.question) throw new Error('That request is no longer pending')
    if (m.method === 'cursor/ask_question') {
      const selected = m.params.questions.map((q: Wire) => ({
        questionId: q.id,
        selectedOptionIds: (q.options ?? [])
          .filter(
            (o: Wire) =>
              answers[q.prompt] === o.label ||
              (q.allowMultiple && (answers[q.prompt] || '').split(', ').includes(o.label)),
          )
          .map((o: Wire) => o.id),
      }))
      if (selected.some((a: Wire) => !a.selectedOptionIds.length))
        throw new Error('Choose one of the advertised answers')
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
      for (const event of this.events.consume(u)) {
        if (event.kind === 'text' && !event.agentId) this.turnText.set(event.messageId ?? '', event.text)
        if (event.kind === 'tool-use' && !event.agentId && !this.seenTools.has(event.toolUseId)) {
          this.seenTools.add(event.toolUseId)
          this.turnTools++
        }
        this.emit(event)
      }
      return
    }
    if (m.method === 'opencode/session/child_update') {
      // Sub-agent progress; rootSessionId ties it to this chat.
      if (
        !this.loading &&
        p.rootSessionId === this.sessionId &&
        p.type === 'update' &&
        p.update &&
        typeof p.childSessionId === 'string'
      )
        for (const event of this.events.consumeChild(p.childSessionId, String(p.title ?? ''), p.update))
          this.emit(event)
      return
    }
    if (m.method === 'cursor/update_todos') {
      if (!this.loading && (p.sessionId === undefined || p.sessionId === this.sessionId))
        for (const event of this.events.updateTodos(p)) this.emit(event)
      return
    }
    if (m.id === undefined) return
    if (m.method === 'cursor/task') {
      // Cursor's report on a finished sub-agent; it needs no answer beyond an acknowledgement.
      this.rpc?.write({ id: m.id, result: {} })
      const event =
        typeof p.toolCallId === 'string'
          ? this.events.updateAgent(p.toolCallId, {
              ...(Number.isFinite(p.durationMs) ? { durationMs: p.durationMs } : {}),
              ...(typeof p.agentId === 'string' ? { address: p.agentId } : {}),
              ...(typeof p.model === 'string' && p.model !== 'default' ? { model: p.model } : {}),
            })
          : undefined
      if (event) this.emit(event)
      return
    }
    // Antigravity asks before its own sub-agents start, so Ramu can refuse them while it routes sub-agents itself.
    if (
      m.method === 'session/request_permission' &&
      this.settings.provider === 'antigravity' &&
      this.connection?.nativeSubagents === false &&
      /invoke_subagent/.test(String(p.toolCall?.title ?? ''))
    ) {
      const option =
        (p.options ?? []).find((o: Wire) => o.kind === 'reject_once') ??
        (p.options ?? []).find((o: Wire) => o.kind === 'reject_always')
      this.rpc?.write({
        id: m.id,
        result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } },
      })
      const event =
        typeof p.toolCall?.toolCallId === 'string'
          ? this.events.updateAgent(p.toolCall.toolCallId, {
              status: 'stopped',
              canStop: false,
              error: 'Sub-agents run through Ramu in this chat',
              endedAt: Date.now(),
            })
          : undefined
      if (event) this.emit(event)
      return
    }
    if (
      m.method === 'session/request_permission' ||
      m.method === 'cursor/ask_question' ||
      m.method === 'cursor/create_plan'
    ) {
      const id = String(m.id)
      if (p.toolCall?.toolCallId)
        for (const event of this.events.consume({ ...p.toolCall, sessionUpdate: 'tool_call_update' })) this.emit(event)
      const interaction =
        m.method === 'session/request_permission' &&
        this.settings.provider === 'antigravity' &&
        String(p.toolCall?.toolCallId).startsWith('interaction_')
      const question = interaction || m.method === 'cursor/ask_question'
      this.pending.set(id, { ...m, question })
      if (question && this.readOnly) {
        this.cancelPending()
        this.rpc?.write({ method: 'session/cancel', params: { sessionId: this.sessionId } })
        return
      }
      if (question) {
        this.emit({
          kind: 'question',
          requestId: id,
          questions: interaction
            ? [
                {
                  question: p.toolCall.title,
                  header: 'Antigravity',
                  multiSelect: false,
                  options: (p.options ?? []).map((o: Wire) => ({ label: o.name, description: '' })),
                },
              ]
            : (p.questions ?? []).map((q: Wire) => ({
                question: q.prompt,
                header: p.title || 'Cursor',
                multiSelect: !!q.allowMultiple,
                options: (q.options ?? []).map((o: Wire) => ({ label: o.label, description: '' })),
              })),
        })
      } else if (this.readOnly) {
        this.replyPermission(id, false)
        return
      } else if (
        m.method !== 'cursor/create_plan' &&
        (this.settings.access === 'full' || (this.settings.access === 'edits' && p.toolCall?.kind === 'edit'))
      ) {
        this.replyPermission(id, true)
        return
      } else
        this.emit({
          kind: 'permission-request',
          requestId: id,
          toolName: p.toolCall?.kind || 'Plan',
          title: p.toolCall?.title || p.name || 'Approve plan?',
          detail: p.plan || JSON.stringify(p.toolCall?.rawInput ?? {}),
        })
      this.emit({ kind: 'state', state: 'needs-input' })
      return
    }
    this.rpc?.write({ id: m.id, error: { code: -32601, message: `Unsupported client method: ${m.method}` } })
  }
}
