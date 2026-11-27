import { exitReason, recordOutput } from './exitReason'
import { ownedEnvironment, trackProcess } from '../agent/processOwners'
import { addTokens } from './turnTokens'
import { modelLegacyMetadata } from './modelLifecycle'
import { modelContextWindow } from './modelContext'
import { permissionKey } from '../agent/permissionApprovals'
import { codexMcpConfig, sessionMcpServers, configuredMcpStatus } from './discoveredMcp'
import { classifyLimit } from './limitClassifier'
import { elicitationRequest, elicitationContent } from '../agent/elicitation'
import { attachmentPrompt } from '../attachments'
import { productionDeploy } from '../agent/dangerousCommands'
import { agentContent } from '@ramu/shared/chat/agentContent'
import { toolDescription, toolInput } from './acpEvents'
// Codex's local app-server protocol, using the user's existing CLI login.
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { tmpdir } from 'node:os'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { createInterface } from 'node:readline'
import type {
  UsageReading,
  Attachment,
  AgentEvent,
  AgentElicitation,
  ElicitationAction,
  AgentContent,
  AgentModel,
  AgentScope,
  AgentSettings,
  AgentSessionInfo,
  AgentTask,
  McpConnection,
  McpSignIn,
} from '@ramu/shared/types'
import type { HelperHistory } from '../agent/helperHistory'
import { mcpCallSkipsCard } from '../agent/toolApprovals'
import { RAMU_NAMESPACE, RamuToolClient, codexDynamicTools, dynamicToolResponse, mcpShaped } from './codexDynamicTools'
import { EXTERNAL_MCP_SERVER } from '../mcp/sessionTools'

// Wire messages are validated by the app-server. Only the consumed fields cross into our domain.
type Wire = Record<string, any>
export class CodexRpc {
  private readonly process: ChildProcessWithoutNullStreams
  private nextId = 0
  private closed = false
  private readonly waiting = new Map<
    number,
    { resolve: (value: Wire) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  onMessage: (message: Wire) => void = () => {}
  onExit: (error: Error) => void = () => {}
  readonly exited: Promise<void>

  constructor(connection?: McpConnection, extraConfig: string[] = [], accountId?: string, cwd?: string) {
    this.process = trackProcess(
      spawn(
        providerBinary('codex'),
        [
          'app-server',
          '--stdio',
          ...extraConfig.flatMap((entry) => ['-c', entry]),
          ...(connection
            ? [
                '-c',
                `mcp_servers.ramu.url=${JSON.stringify(connection.url)}`,
                '-c',
                'mcp_servers.ramu.bearer_token_env_var="RAMU_MCP_TOKEN"',
                '-c',
                'mcp_servers.ramu.tool_timeout_sec=3600',
                ...(connection.nativeSubagents === false ? ['-c', 'features.multi_agent=false'] : []),
              ]
            : []),
        ],
        {
          stdio: 'pipe',
          env: ownedEnvironment({
            ...providerEnvironment('codex', undefined, accountId, cwd),
            ...(connection ? { RAMU_MCP_TOKEN: connection.token } : {}),
          }),
        },
      ),
    )
    const output = recordOutput(this.process.stderr)
    const lines = createInterface({ input: this.process.stdout })
    lines.on('line', (line) => {
      let m: Wire
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
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
        for (const p of this.waiting.values()) {
          clearTimeout(p.timer)
          p.reject(error)
        }
        this.waiting.clear()
        if (!this.closed) this.onExit(error)
        lines.close()
        resolve()
      }
      this.process.once('error', (error) =>
        finish(new Error(`Cannot start Codex. Install the Codex CLI and sign in first. ${error.message}`)),
      )
      this.process.once('exit', (code, signal) =>
        finish(new Error(exitReason('Codex app-server', code, signal, output.last()))),
      )
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
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`Codex ${method} timed out`))
      }, 30_000)
      this.waiting.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }
  /** `experimental` opts into the app-server's experimental fields, which dynamic tools need. */
  async initialize(experimental = false): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'ramu', title: 'Ramu', version: '0.0.1' },
      ...(experimental ? { capabilities: { experimentalApi: true } } : {}),
    })
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

export async function codexModels(accountId?: string): Promise<AgentModel[]> {
  const rpc = new CodexRpc(undefined, [], accountId)
  try {
    await rpc.initialize()
    const models: AgentModel[] = []
    let cursor: string | null = null
    do {
      const result = await rpc.request('model/list', { cursor, limit: 100 })
      for (const m of result.data ?? []) {
        if (!m.hidden)
          models.push({
            provider: 'codex',
            id: m.model,
            name: m.displayName,
            ...modelLegacyMetadata(m),
            ...(modelContextWindow(m) ? { contextWindow: modelContextWindow(m) } : {}),
            efforts: (m.supportedReasoningEfforts ?? []).map((e: Wire) => e.reasoningEffort),
            defaultEffort: m.defaultReasoningEffort,
            isDefault: m.isDefault,
            serviceTiers: (m.serviceTiers ?? []).map((tier: Wire) => tier.id).concat(m.additionalSpeedTiers ?? []),
          })
      }
      cursor = result.nextCursor ?? null
    } while (cursor)
    return models
  } finally {
    await rpc.close()
  }
}

/** One login's plan usage, read without starting a chat. */
export async function codexUsage(accountId?: string): Promise<UsageReading[]> {
  const rpc = new CodexRpc(undefined, [], accountId)
  try {
    await rpc.initialize()
    return codexReadings((await rpc.request('account/rateLimits/read', {})).rateLimits)
  } finally {
    await rpc.close()
  }
}

// Compatibility aliases for existing Codex factories.
export type { AgentRunnerFactory as CodexFactory } from '../agent/agentRunner'
import type { AgentRunner as CodexRunner, AgentRunnerFactory as CodexFactory } from '../agent/agentRunner'
import { SessionInUse } from '../agent/agentRunner'
import { deliverLoopbackCallback, loopbackRedirect } from '../agent/mcpCallback'

export const createCodexRunner: CodexFactory = (scope, settings, emit, readOnly, onTitle) =>
  new CodexSession(scope, settings, emit, readOnly, onTitle)
class CodexSession implements CodexRunner {
  private readonly requestScope = randomUUID()
  private rpc!: CodexRpc
  private connection?: McpConnection
  /** Answers Codex's calls to the dynamic tools; see codexDynamicTools.ts. */
  private ramuTools?: RamuToolClient
  /** Ends dynamic tool calls still waiting when the chat stops. */
  private readonly toolCalls = new AbortController()
  private threadId = ''
  /** Where each sign-in under way waits for its page to return on this host. */
  private readonly mcpReturns = new Map<string, URL>()
  private turnId = ''
  /** Tokens the current turn's model calls used so far; null outside a turn or before Codex reports any. */
  private turnUsage: { input: number; output: number } | null = null
  private readonly completedTurns = new Set<string>()
  private readonly compactedItems = new Set<string>()
  private modernCompactionTurn = ''
  private legacyCompactionTurn = ''
  private stopped = false
  private limit = false
  private readonly toolOutput = new Map<string, string>()
  private readonly toolPatches = new Map<string, Wire[]>()
  private readonly completedTools = new Set<string>()
  private readonly messages = new Map<string, string>()
  private readonly thoughts = new Map<string, string>()
  /** Sub-agent threads this thread spawned, so their events can be shown as theirs. */
  private readonly agents = new Set<string>()
  private readonly pending = new Map<
    string,
    { id: number | string; questions?: Wire[]; permissions?: Wire; elicitation?: AgentElicitation }
  >()
  constructor(
    private readonly scope: AgentScope,
    private readonly settings: AgentSettings,
    private readonly emit: (event: AgentEvent, usageLimit?: boolean | 'low') => void,
    private readonly readOnly = false,
    private readonly onTitle?: (title: string) => void,
  ) {}
  setTools(connection: McpConnection): void {
    this.connection = connection
    void this.ramuTools?.close()
    this.ramuTools = new RamuToolClient(connection)
  }
  async mcpStatus() {
    if (!this.rpc || !this.threadId || this.stopped) return configuredMcpStatus(this.scope, this.connection)
    const servers = []
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await this.rpc.request('mcpServerStatus/list', {
        threadId: this.threadId,
        limit: 100,
        detail: 'toolsAndAuthOnly',
        ...(cursor ? { cursor } : {}),
      })
      for (const server of page.data ?? []) {
        const states: Record<string, string> = {
          notStarted: 'pending',
          starting: 'pending',
          authenticationRequired: 'needs-auth',
          cancelled: 'cancelled',
        }
        // A tool catalog or saved credentials alone do not prove a live connection.
        const status = server.runtimeStatus
          ? (states[server.runtimeStatus] ?? server.runtimeStatus)
          : server.authStatus === 'notLoggedIn'
            ? 'needs-auth'
            : server.toolsError
              ? 'failed'
              : 'unknown'
        servers.push({
          name: String(server.name),
          status,
          ...(server.tools ? { toolCount: Object.keys(server.tools).length } : {}),
          ...(server.toolsError ? { error: String(server.toolsError) } : {}),
        })
      }
      cursor = page.nextCursor ?? undefined
      if (cursor && seen.has(cursor)) throw new Error('Codex repeated an MCP inventory cursor')
      if (cursor) seen.add(cursor)
      if (seen.size >= 100) throw new Error('Codex MCP inventory exceeded the page limit')
    } while (cursor)
    return { supported: true, live: true, source: 'live' as const, canReload: true, canAuthenticate: true, servers }
  }

  async signInMcp(name: string): Promise<McpSignIn> {
    if (!this.rpc || !this.threadId || this.stopped) throw new Error('Codex session is not running')
    const answer = await this.rpc.request('mcpServer/oauth/login', { name, threadId: this.threadId })
    const authUrl = typeof answer?.authorizationUrl === 'string' ? answer.authorizationUrl : undefined
    // Codex listens for the page's return on the host itself, as Claude Code does.
    const redirect = authUrl ? loopbackRedirect(authUrl) : undefined
    if (redirect) this.mcpReturns.set(name, redirect)
    else this.mcpReturns.delete(name)
    return { ...(authUrl ? { authUrl } : {}), returnsToHost: !!redirect }
  }

  async finishMcpSignIn(name: string, callbackUrl: string): Promise<void> {
    const expected = this.mcpReturns.get(name)
    if (!expected) throw new Error('No sign-in is waiting for this server. Start the sign-in again.')
    await deliverLoopbackCallback(expected, callbackUrl)
    this.mcpReturns.delete(name)
  }

  async reloadMcp(): Promise<void> {
    if (!this.rpc || this.stopped) throw new Error('Codex session is not running')
    await this.rpc.request('config/mcpServer/reload', {})
  }

  private policies() {
    if (this.readOnly) return { approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } }
    // Full access still routes commands through approval so Ramu can stop the dangerous few; it answers the rest at
    // once, and nothing runs sandboxed.
    return this.settings.access === 'full'
      ? { approvalPolicy: 'untrusted', sandboxPolicy: { type: 'dangerFullAccess' } }
      : {
          approvalPolicy: this.settings.access === 'auto' ? 'on-request' : 'untrusted',
          sandboxPolicy: {
            type: 'workspaceWrite',
            writableRoots: [this.scope.cwd, ...this.scope.additionalDirs],
            networkAccess: false,
          },
        }
  }
  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    this.rpc = new CodexRpc(
      this.connection,
      [
        ...(this.connection?.interceptSubagents ? [CODEX_HOOK_CONFIG] : []),
        ...(this.connection
          ? codexMcpConfig(
              sessionMcpServers(
                this.scope,
                this.connection,
                'codex',
                this.settings.accountId,
                this.connection?.sharingProjectId,
              ),
            )
          : []),
      ],
      this.settings.accountId ?? 'default',
      this.scope.cwd,
    )
    this.rpc.onMessage = (m) => this.handle(m)
    this.rpc.onExit = (e) => {
      if (!this.stopped) {
        this.emit({ kind: 'error', message: e.message })
        this.emit({ kind: 'state', state: 'failed' })
      }
    }
    // A new thread declares the tools an agent must always see as dynamic tools; Codex keeps them with the thread, so a
    // resumed one has them already. Without them (no endpoint, or it can't be read) the MCP copies still serve.
    const dynamicTools =
      !resume && !this.readOnly && this.ramuTools ? await this.ramuTools.list().then(codexDynamicTools, () => []) : []
    await this.rpc.initialize(dynamicTools.length > 0)
    // The first reading, before any turn has run; failures only mean no gauge yet.
    void this.rpc.request('account/rateLimits/read', {}).then(
      (result) => this.reportUsage(result.rateLimits),
      () => {},
    )
    const full = this.settings.access === 'full'
    const result = await this.rpc
      .request(resume ? 'thread/resume' : 'thread/start', {
        ...(resume ? { threadId: resume } : {}),
        cwd: this.scope.cwd,
        ...(!resume && this.readOnly ? { ephemeral: true } : {}),
        ...(this.settings.model ? { model: this.settings.model } : {}),
        ...(this.connection?.instructions ? { developerInstructions: this.connection.instructions } : {}),
        serviceTier: this.settings.serviceTier === 'fast' ? 'fast' : 'default',
        ...(this.settings.serviceTier === 'fast' ? { config: { 'features.fast_mode': true } } : {}),
        approvalPolicy: this.policies().approvalPolicy,
        sandbox: this.readOnly ? 'read-only' : full ? 'danger-full-access' : 'workspace-write',
        ...(dynamicTools.length ? { dynamicTools } : {}),
      })
      .catch((e: Error) => {
        // Codex lets one client write to a conversation at a time; the Codex app or CLI may have it open.
        if (resume && /already has an active writer/i.test(e.message))
          throw new SessionInUse(
            'This conversation is open in another Codex client, such as the Codex app, the Codex CLI or an editor extension. Codex lets one client write to it at a time. Quit that client, then send your message again.',
          )
        throw e
      })
    this.threadId = result.thread.id
    this.emit({
      kind: 'init',
      mcpServers: configuredMcpStatus(this.scope, this.connection, true, {
        provider: 'codex',
        accountId: this.settings.accountId,
      }).servers,
      model: result.model || this.settings.model || 'Codex default',
      cwd: this.scope.cwd,
      providerSessionId: this.threadId,
    })
    await this.send(prompt, attachments)
  }
  async send(prompt: string, attachments?: Attachment[]): Promise<void> {
    if (this.turnId) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    this.limit = false
    const result = await this.rpc.request('turn/start', {
      threadId: this.threadId,
      input: [
        { type: 'text', text: attachmentPrompt(prompt, attachments) },
        ...(attachments ?? [])
          .filter((file) => file.mimeType.startsWith('image/'))
          .map((file) => ({ type: 'localImage', path: file.path })),
      ],
      cwd: this.scope.cwd,
      ...this.policies(),
      ...(this.settings.model ? { model: this.settings.model } : {}),
      ...(this.settings.effort ? { effort: this.settings.effort } : {}),
      // Without this Codex sends no reasoning summaries for models whose config defaults to none.
      summary: 'auto',
      serviceTier: this.settings.serviceTier === 'fast' ? 'fast' : 'default',
    })
    this.turnId = this.completedTurns.has(result.turn.id) ? '' : result.turn.id
  }
  async steer(prompt: string, attachments?: Attachment[]): Promise<void> {
    if (!this.turnId) throw new Error('The turn has finished. Send the message again.')
    await this.rpc.request('turn/steer', {
      threadId: this.threadId,
      expectedTurnId: this.turnId,
      input: [
        { type: 'text', text: attachmentPrompt(prompt, attachments) },
        ...(attachments ?? [])
          .filter((file) => file.mimeType.startsWith('image/'))
          .map((file) => ({ type: 'localImage', path: file.path })),
      ],
    })
  }
  async interrupt(): Promise<void> {
    for (const [id, request] of this.pending) if (request.elicitation) this.replyElicitation(id, 'cancel', {})
    if (this.turnId) await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
  }
  async stop(): Promise<void> {
    this.stopped = true
    for (const [id, req] of this.pending) {
      if (req.elicitation) this.rpc.write({ id: req.id, result: { action: 'cancel', content: null, _meta: null } })
      this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
    }
    this.pending.clear()
    this.toolCalls.abort()
    await Promise.all([this.rpc?.close(), this.ramuTools?.close()])
  }
  /** One dynamic tool call, run on Ramu's own endpoint; a failure goes back to the model as the tool's answer. */
  private async callDynamicTool(p: Wire): Promise<Wire> {
    const failed = (text: string) => ({ contentItems: [{ type: 'inputText', text }], success: false })
    if (p.namespace !== RAMU_NAMESPACE || typeof p.tool !== 'string' || !this.ramuTools)
      return failed(`Unknown tool ${String(p.tool)}`)
    try {
      const args = p.arguments && typeof p.arguments === 'object' ? (p.arguments as Record<string, unknown>) : {}
      return dynamicToolResponse(await this.ramuTools.call(p.tool, args, this.toolCalls.signal))
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
  }
  replyPermission(id: string, allow: boolean): void {
    const req = this.pending.get(id)
    if (!req || req.questions || req.elicitation) throw new Error('That request is no longer pending')
    this.pending.delete(id)
    this.rpc.write({
      id: req.id,
      result: req.permissions
        ? { permissions: allow ? req.permissions : {}, scope: 'turn' }
        : { decision: allow ? 'accept' : 'decline' },
    })
    this.emit({ kind: 'request-resolved', requestId: id, outcome: allow ? 'allowed' : 'denied' })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  replyQuestion(id: string, answers: Record<string, string>): void {
    const req = this.pending.get(id)
    if (!req?.questions) throw new Error('That request is no longer pending')
    this.pending.delete(id)
    this.rpc.write({
      id: req.id,
      result: {
        answers: Object.fromEntries(
          req.questions.map((q) => [q.id, { answers: [answers[q.id] ?? answers[q.question] ?? ''] }]),
        ),
      },
    })
    this.emit({ kind: 'request-resolved', requestId: id, outcome: 'answered' })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
  replyElicitation(id: string, action: ElicitationAction, answers: Record<string, string>): void {
    const req = this.pending.get(id)
    if (!req?.elicitation) throw new Error('That input request is no longer pending.')
    const content = action === 'accept' ? elicitationContent(req.elicitation, answers) : null
    this.rpc.write({ id: req.id, result: { action, content, _meta: null } })
    this.pending.delete(id)
    this.emit({
      kind: 'request-resolved',
      requestId: id,
      outcome: action === 'accept' ? 'answered' : action === 'decline' ? 'declined' : 'cancelled',
    })
    if (!this.pending.size) this.emit({ kind: 'state', state: this.turnId ? 'running' : 'idle' })
  }
  private reportUsage(snapshot: Wire | undefined): void {
    const readings = codexReadings(snapshot).map((reading) => ({
      ...reading,
      ...(this.settings.accountId && this.settings.accountId !== 'default'
        ? { accountId: this.settings.accountId }
        : {}),
    }))
    if (readings.length) this.emit({ kind: 'usage', readings })
  }

  /** A collab tool call names the sub-agent threads it touched and their states. */
  private trackAgents(item: Wire): void {
    const ids: string[] = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((value: unknown) => typeof value === 'string')
      : []
    const states: Wire = item.agentsStates ?? {}
    for (const threadId of ids) {
      const known = this.agents.has(threadId)
      this.agents.add(threadId)
      const state = Array.isArray(states)
        ? states.find((entry: Wire) => entry?.threadId === threadId || entry?.id === threadId)
        : states[threadId]
      const spawning = item.tool === 'spawnAgent'
      if (!known || state !== undefined)
        this.emit({
          kind: 'agent',
          agentId: threadId,
          ...(!known ? { toolUseId: item.id } : {}),
          name: String(
            state?.nickname ??
              state?.agentNickname ??
              (known ? '' : item.prompt ? String(item.prompt).split('\n')[0]!.slice(0, 80) : 'Sub-agent'),
          ),
          ...((state?.role ?? state?.agentRole) ? { agentType: String(state.role ?? state.agentRole) } : {}),
          ...(!known && item.model ? { model: String(item.model) } : {}),
          ...(!known && item.reasoningEffort ? { effort: item.reasoningEffort } : {}),
          status:
            state !== undefined
              ? codexAgentStatus(state?.status ?? state)
              : spawning && item.status === 'failed'
                ? 'failed'
                : 'running',
          ...(item.prompt && spawning ? { prompt: String(item.prompt) } : {}),
          ...(!known ? { startedAt: Date.now() } : {}),
          ...(state?.message ? { summary: String(state.message) } : {}),
          address: threadId,
          canStop: true,
          canMessage: true,
          recovered: false,
          recoveryError: '',
        })
    }
  }

  private toolKey(threadId: string, itemId: string): string {
    return `${threadId}:${itemId}`
  }
  private toolId(threadId: string, itemId: string): string {
    return threadId === this.threadId ? itemId : this.toolKey(threadId, itemId)
  }

  private liveTool(threadId: string, method: string, p: Wire): boolean {
    const tag = threadId === this.threadId ? {} : { agentId: threadId }
    if (method === 'turn/diff/updated') {
      if (typeof p.turnId === 'string' && typeof p.diff === 'string')
        this.emit({
          kind: 'turn-diff',
          turnId: this.toolKey(threadId, p.turnId),
          diff: p.diff.slice(0, 256_000),
          ...tag,
        })
      return true
    }
    if (method !== 'item/commandExecution/outputDelta' && method !== 'item/fileChange/patchUpdated') return false
    if (typeof p.itemId !== 'string') return true
    const key = this.toolKey(threadId, p.itemId)
    if (this.completedTools.has(key)) return true
    let summary: string
    if (method === 'item/commandExecution/outputDelta') {
      if (typeof p.delta !== 'string') return true
      summary = ((this.toolOutput.get(key) ?? '') + p.delta).slice(-64_000)
      this.toolOutput.set(key, summary)
    } else {
      if (!Array.isArray(p.changes)) return true
      this.toolPatches.set(key, p.changes)
      summary = patchSummary(p.changes)
    }
    this.emit({
      kind: 'tool-result',
      toolUseId: this.toolId(threadId, p.itemId),
      isError: false,
      summary,
      running: true,
      ...tag,
    })
    return true
  }

  private toolResult(threadId: string, item: Wire): string {
    const key = this.toolKey(threadId, item.id)
    const summary =
      item.type === 'commandExecution'
        ? String(item.aggregatedOutput ?? this.toolOutput.get(key) ?? '').slice(-64_000)
        : item.type === 'fileChange'
          ? patchSummary(item.changes ?? this.toolPatches.get(key) ?? [])
          : JSON.stringify(item.result ?? '')
    this.toolOutput.delete(key)
    this.toolPatches.delete(key)
    this.completedTools.add(key)
    if (this.completedTools.size > 512) this.completedTools.delete(this.completedTools.values().next().value!)
    return summary
  }

  /** Output from a sub-agent's own thread, marked as that agent's. Agent updates leave `name` empty to keep the recorded one. */
  private handleAgent(threadId: string, method: string, p: Wire): void {
    const tag = { agentId: threadId }
    if (this.liveTool(threadId, method, p)) return
    if (method === 'turn/started') this.emit({ kind: 'agent', agentId: threadId, name: '', status: 'running' })
    if (method === 'turn/completed')
      this.emit({
        kind: 'agent',
        agentId: threadId,
        name: '',
        status: p.turn?.status === 'failed' ? 'failed' : p.turn?.status === 'interrupted' ? 'stopped' : 'completed',
        endedAt: Date.now(),
        ...(p.turn?.error?.message ? { error: String(p.turn.error.message) } : {}),
      })
    if (method === 'item/agentMessage/delta') {
      const key = `${threadId}:${p.itemId}`,
        text = (this.messages.get(key) || '') + (p.delta || '')
      this.messages.set(key, text)
      this.emit({ kind: 'text', text, messageId: key, ...tag })
    }
    if (method !== 'item/started' && method !== 'item/completed') return
    const item = mcpShaped(p.item ?? {}),
      complete = method === 'item/completed'
    if (item.type === 'agentMessage' && complete && item.text) {
      this.messages.delete(`${threadId}:${item.id}`)
      this.emit({ kind: 'text', text: item.text, messageId: `${threadId}:${item.id}`, ...tag })
    }
    if (item.type === 'reasoning' && complete) this.thoughts.delete(`${threadId}:${item.id}`)
    const extra = toolOfOtherItem(item)
    if (extra)
      this.emit(
        complete
          ? {
              kind: 'tool-result',
              toolUseId: this.toolId(threadId, item.id),
              isError: item.status === 'failed',
              summary: extra.result,
              content: extra.content,
              ...tag,
            }
          : {
              kind: 'tool-use',
              toolUseId: this.toolId(threadId, item.id),
              name: extra.name,
              summary: extra.summary,
              title: extra.title,
              content: extra.content,
              ...tag,
            },
      )
    if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall') {
      if (!complete)
        this.emit({
          kind: 'tool-use',
          toolUseId: this.toolId(threadId, item.id),
          name: item.type === 'commandExecution' ? 'Bash' : item.type === 'fileChange' ? 'Edit' : item.tool || 'Tool',
          summary: item.command || (item.changes ?? []).map((c: Wire) => c.path).join(', ') || item.server || '',
          title: typeof item.description === 'string' ? item.description : toolDescription(item.arguments),
          input: toolInput(item.arguments ?? item.command),
          ...tag,
        })
      else
        this.emit({
          kind: 'tool-result',
          toolUseId: this.toolId(threadId, item.id),
          isError: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0),
          summary: this.toolResult(threadId, item),
          ...tag,
        })
    }
  }

  restoreAgent(threadId: string, turns: Wire[]): void {
    for (const turn of turns)
      for (const item of turn.items ?? []) {
        this.handleAgent(threadId, 'item/started', { item })
        if (item.type === 'agentMessage' || !['inProgress', 'running'].includes(item.status))
          this.handleAgent(threadId, 'item/completed', { item })
      }
  }

  private handle(m: Wire): void {
    if (this.stopped || !m.method) return
    const p = m.params ?? {}
    const sub = !!p.threadId && !!this.threadId && p.threadId !== this.threadId
    if (
      m.method === 'item/reasoning/summaryTextDelta' &&
      typeof p.itemId === 'string' &&
      typeof p.delta === 'string' &&
      (!sub || this.agents.has(p.threadId))
    ) {
      const key = `${p.threadId ?? this.threadId}:${p.itemId}`
      const text = (this.thoughts.get(key) ?? '') + p.delta
      this.thoughts.set(key, text)
      this.emit({
        kind: 'thinking',
        text,
        messageId: this.toolId(p.threadId ?? this.threadId, p.itemId),
        ...(sub ? { agentId: p.threadId } : {}),
      })
      return
    }
    // Requests from a sub-agent thread need an answer like any other, or that agent waits forever.
    if (sub && m.id === undefined) {
      if (this.agents.has(p.threadId)) this.handleAgent(p.threadId, m.method, p)
      return
    }
    if (m.id !== undefined) {
      const id = String(m.id)
      if (
        this.settings.access === 'full' &&
        !this.readOnly &&
        (m.method === 'item/commandExecution/requestApproval' ||
          m.method === 'item/fileChange/requestApproval' ||
          m.method === 'item/permissions/requestApproval')
      ) {
        const command = Array.isArray(p.command) ? p.command.join(' ') : p.command
        const danger = typeof command === 'string' ? productionDeploy(command) : null
        if (!danger) {
          this.rpc.write({
            id: m.id,
            result:
              m.method === 'item/permissions/requestApproval'
                ? { permissions: p.permissions, scope: 'turn' }
                : { decision: 'accept' },
          })
          return
        }
        this.pending.set(id, { id: m.id })
        this.emit({
          kind: 'permission-request',
          requestId: id,
          toolName: 'Bash',
          title: 'Allow command?',
          detail: command,
          approvalOnceOnly: true,
          approvalFullAccess: { reason: danger },
          approvalCommand: command,
        })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else if (
        m.method === 'item/commandExecution/requestApproval' ||
        m.method === 'item/fileChange/requestApproval'
      ) {
        this.pending.set(id, { id: m.id })
        this.emit({
          kind: 'permission-request',
          requestId: id,
          toolName: m.method.includes('commandExecution') ? 'Bash' : 'Edit',
          title: m.method.includes('commandExecution') ? 'Allow command?' : 'Allow file changes?',
          detail: [p.command, p.reason].filter(Boolean).join('\n'),
          ...(p.command
            ? {
                approvalCommand: typeof p.command === 'string' ? p.command : undefined,
                approvalKey: permissionKey(
                  'Bash',
                  Object.fromEntries(
                    Object.entries(p).filter(([key]) => !['threadId', 'turnId', 'itemId', 'reason'].includes(key)),
                  ),
                ),
              }
            : {}),
        })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else if (m.method === 'item/permissions/requestApproval') {
        this.pending.set(id, { id: m.id, permissions: p.permissions })
        this.emit({
          kind: 'permission-request',
          requestId: id,
          toolName: 'Permissions',
          title: 'Allow additional access?',
          detail: [p.reason, JSON.stringify(p.permissions, null, 2)].filter(Boolean).join('\n'),
        })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else if (m.method === 'item/tool/requestUserInput') {
        this.pending.set(id, { id: m.id, questions: p.questions })
        this.emit({
          kind: 'question',
          requestId: id,
          questions: (p.questions ?? []).map((q: Wire) => ({
            id: q.id,
            question: q.question,
            header: q.header,
            multiSelect: false,
            options: q.options ?? [],
          })),
        })
        this.emit({ kind: 'state', state: 'needs-input' })
      } else if (
        m.method === 'mcpServer/elicitation/request' &&
        !this.readOnly &&
        (p._meta?.codex_approval_kind === 'mcp_tool_call' || id.startsWith('mcp_tool_call_approval_')) &&
        (this.settings.access === 'full' ||
          mcpCallSkipsCard(
            this.settings.access,
            p.serverName === 'ramu' ? 'ramu' : p.serverName === EXTERNAL_MCP_SERVER ? 'shared_mcp' : 'other',
            typeof p._meta?.tool_name === 'string' ? p._meta.tool_name : '',
            p._meta?.tool_params && typeof p._meta.tool_params === 'object' ? p._meta.tool_params : undefined,
          ))
      ) {
        // Codex asks before MCP tool calls under the approval policies Ramu uses. Full access allows them all; otherwise
        // Ramu answers the calls it already decides on the host, the same way for every provider (toolApprovals.ts).
        this.rpc.write({ id: m.id, result: { action: 'accept', content: {}, _meta: null } })
      } else if (m.method === 'mcpServer/elicitation/request') {
        try {
          const requestId = `mcp:${this.requestScope}:${id}`
          const request = elicitationRequest(requestId, p)
          this.pending.set(requestId, { id: m.id, elicitation: request })
          this.emit({ kind: 'elicitation', ...request })
          this.emit({ kind: 'state', state: 'needs-input' })
        } catch (error) {
          this.rpc.write({ id: m.id, result: { action: 'cancel', content: null, _meta: null } })
          this.emit({
            kind: 'error',
            message: `Could not display ${p.serverName ?? 'MCP server'} input request: ${String(error)}`,
          })
        }
      } else if (m.method === 'item/tool/call') {
        void this.callDynamicTool(p).then((result) => this.rpc.write({ id: m.id, result }))
      } else this.rpc.write({ id: m.id, error: { code: -32601, message: `Ramu does not support ${m.method}` } })
      return
    }
    if (this.liveTool(this.threadId, m.method, p)) return
    if (m.method === 'account/rateLimits/updated') this.reportUsage(p.rateLimits)
    // The app-server's thread name, only for this conversation's own thread and never a sub-agent's.
    if (m.method === 'thread/name/updated' && p.threadId === this.threadId && typeof p.threadName === 'string')
      this.onTitle?.(p.threadName)
    if (m.method === 'thread/tokenUsage/updated') {
      // Each update carries the last model call's usage; a resumed thread's earlier totals never count.
      if (this.turnId && (!p.threadId || p.threadId === this.threadId))
        this.turnUsage = addTokens(this.turnUsage, codexLast(p.tokenUsage))
      const context = codexContext(p.tokenUsage)
      if (context) this.emit({ kind: 'context', ...context })
    }
    // The thread's own name, when app-server reports one for this thread. Sub-agent threads are ignored.
    if (m.method === 'thread/name/updated' && p.threadId === this.threadId && typeof p.threadName === 'string')
      this.emit({ kind: 'title', title: p.threadName })
    if (m.method === 'turn/started') {
      this.turnId = p.turn.id
      this.turnUsage = null
      this.emit({ kind: 'state', state: 'running' })
    }
    if (
      m.method === 'thread/compacted' &&
      p.turnId !== this.modernCompactionTurn &&
      p.turnId !== this.legacyCompactionTurn
    ) {
      this.legacyCompactionTurn = p.turnId
      this.emit({ kind: 'compaction', state: 'completed' })
    }
    if (m.method === 'error') {
      const info = JSON.stringify(p.error?.codexErrorInfo ?? '')
      this.limit ||= classifyLimit(info, { provider: 'codex', channel: 'error' })?.confidence === 'high'
      if (!p.willRetry) this.emit({ kind: 'error', message: p.error?.message || 'Codex failed' }, this.limit)
    }
    if (m.method === 'item/agentMessage/delta') {
      const text = (this.messages.get(p.itemId) || '') + (p.delta || '')
      this.messages.set(p.itemId, text)
      this.emit({ kind: 'text', text, messageId: p.itemId })
    }
    if (m.method === 'item/started' || m.method === 'item/completed') {
      const item = mcpShaped(p.item ?? {})
      const complete = m.method === 'item/completed'
      if (item.type === 'agentMessage' && item.delivery === 'async' && item.questions?.length && complete) {
        this.messages.delete(item.id)
        this.emit({
          kind: 'question',
          requestId: `async:${this.threadId}:${item.id}`,
          responseMode: 'message',
          grouping: 'together',
          questions: item.questions.map((q: Wire, index: number) => ({
            id: String(index),
            question: q.title,
            header: 'Question',
            multiSelect: false,
            options: (q.options ?? []).map((label: string) => ({ label, description: '' })),
          })),
        })
        return
      }
      if (item.type === 'contextCompaction') {
        if (!complete) this.emit({ kind: 'compaction', state: 'started' })
        else if (!this.compactedItems.has(item.id)) {
          this.compactedItems.add(item.id)
          if (this.compactedItems.size > 100) this.compactedItems.delete(this.compactedItems.values().next().value!)
          this.modernCompactionTurn = p.turnId || this.turnId
          if (this.modernCompactionTurn !== this.legacyCompactionTurn)
            this.emit({ kind: 'compaction', state: 'completed' })
        }
      }
      if (item.type === 'agentMessage' && complete) this.messages.delete(item.id)
      if (item.type === 'agentMessage' && complete && item.text)
        this.emit({ kind: 'text', text: item.text, messageId: item.id })
      if (item.type === 'reasoning' && complete) {
        this.thoughts.delete(`${this.threadId}:${item.id}`)
        const text = (Array.isArray(item.summary) ? item.summary : [])
          .filter((part: unknown) => typeof part === 'string' && part.trim())
          .join('\n\n')
        if (text) this.emit({ kind: 'thinking', text, messageId: item.id })
      }
      // Web searches, page opens and image views are tool calls too; without them a research turn looks like silence.
      if (item.type === 'collabAgentToolCall') this.trackAgents(item)
      const extra = toolOfOtherItem(item)
      if (extra) {
        if (!complete)
          this.emit({
            kind: 'tool-use',
            toolUseId: item.id,
            name: extra.name,
            summary: extra.summary,
            title: extra.title,
            content: extra.content,
          })
        else
          this.emit({
            kind: 'tool-result',
            toolUseId: item.id,
            isError: item.status === 'failed',
            summary: extra.result,
            content: extra.content,
          })
      }
      if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall') {
        if (!complete)
          this.emit({
            kind: 'tool-use',
            toolUseId: item.id,
            name: item.type === 'commandExecution' ? 'Bash' : item.type === 'fileChange' ? 'Edit' : item.tool || 'Tool',
            summary: item.command || (item.changes ?? []).map((c: Wire) => c.path).join(', ') || item.server || '',
            title: typeof item.description === 'string' ? item.description : toolDescription(item.arguments),
            input: toolInput(item.arguments ?? item.command),
          })
        else
          this.emit({
            kind: 'tool-result',
            toolUseId: item.id,
            isError: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0),
            summary: this.toolResult(this.threadId, item),
            ...(Array.isArray(item.result?.content) ? { content: agentContent(item.result.content) } : {}),
          })
      }
    }
    if (m.method === 'serverRequest/resolved') {
      const id =
        [...this.pending].find(([, request]) => String(request.id) === String(p.requestId))?.[0] ?? String(p.requestId)
      if (this.pending.delete(id)) {
        this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
        if (!this.pending.size) this.emit({ kind: 'state', state: this.turnId ? 'running' : 'idle' })
      }
    }
    if (m.method === 'turn/completed') {
      this.completedTurns.add(p.turn.id)
      if (this.completedTurns.size > 100) this.completedTurns.delete(this.completedTurns.values().next().value!)
      this.turnId = ''
      const error = p.turn.error
      this.limit ||=
        classifyLimit(JSON.stringify(error?.codexErrorInfo ?? ''), { provider: 'codex', channel: 'error' })
          ?.confidence === 'high'
      const tokens = this.turnUsage
      this.turnUsage = null
      this.emit(
        {
          kind: 'result',
          isError: p.turn.status === 'failed',
          text: error?.message || p.turn.status,
          costUsd: null,
          ...(tokens ? { tokens } : {}),
        },
        this.limit,
      )
      // AgentService owns the state transition and any fallback.
    }
  }
}

/** Turns a saved sub-agent thread back into the events its output was shown with. Every event is marked as the agent's own. */
function replayCodexAgent(agentId: string, turns: Wire[], emit: (event: AgentEvent) => void): void {
  const tag = { agentId }
  const toolUseId = (itemId: string) => `${agentId}:${itemId}`
  const replay = (item: Wire, complete: boolean) => {
    if (item.type === 'agentMessage' && complete && item.text)
      emit({ kind: 'text', text: item.text, messageId: toolUseId(item.id), ...tag })
    const extra = toolOfOtherItem(item)
    if (extra)
      emit(
        complete
          ? {
              kind: 'tool-result',
              toolUseId: toolUseId(item.id),
              isError: item.status === 'failed',
              summary: extra.result,
              content: extra.content,
              ...tag,
            }
          : {
              kind: 'tool-use',
              toolUseId: toolUseId(item.id),
              name: extra.name,
              summary: extra.summary,
              title: extra.title,
              content: extra.content,
              ...tag,
            },
      )
    if (item.type !== 'commandExecution' && item.type !== 'fileChange' && item.type !== 'mcpToolCall') return
    if (!complete)
      emit({
        kind: 'tool-use',
        toolUseId: toolUseId(item.id),
        name: item.type === 'commandExecution' ? 'Bash' : item.type === 'fileChange' ? 'Edit' : item.tool || 'Tool',
        summary: item.command || (item.changes ?? []).map((c: Wire) => c.path).join(', ') || item.server || '',
        title: typeof item.description === 'string' ? item.description : toolDescription(item.arguments),
        input: toolInput(item.arguments ?? item.command),
        ...tag,
      })
    else
      emit({
        kind: 'tool-result',
        toolUseId: toolUseId(item.id),
        isError: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0),
        summary:
          item.type === 'commandExecution'
            ? String(item.aggregatedOutput ?? '').slice(-64_000)
            : item.type === 'fileChange'
              ? patchSummary(item.changes ?? [])
              : JSON.stringify(item.result ?? ''),
        ...tag,
      })
  }
  for (const turn of turns)
    for (const raw of turn.items ?? []) {
      const item = mcpShaped(raw)
      replay(item, false)
      if (item.type === 'agentMessage' || !['inProgress', 'running'].includes(item.status)) replay(item, true)
    }
}

/** Read persisted helper threads without thread/resume or turn/start. */
export async function codexHelperHistory(session: AgentSessionInfo, tasks: AgentTask[]): Promise<HelperHistory[]> {
  const rpc = new CodexRpc(undefined, [], session.settings.accountId ?? 'default')
  try {
    await rpc.initialize()
    const root = await rpc.request('thread/read', { threadId: session.providerSessionId, includeTurns: true })
    const known = new Map(tasks.map((task) => [task.agentId, task]))
    // A spawn may have been persisted by Codex just before Ramu crashed, before its notification reached us.
    for (const turn of root.thread?.turns ?? [])
      for (const item of turn.items ?? []) {
        if (item.type !== 'collabAgentToolCall' || item.tool !== 'spawnAgent') continue
        for (const agentId of item.receiverThreadIds ?? [])
          if (typeof agentId === 'string' && !known.has(agentId))
            known.set(agentId, {
              agentId,
              name: String(item.prompt || 'Recovered agent')
                .split('\n')[0]!
                .slice(0, 80),
              prompt: item.prompt,
              status: 'running',
              toolUseId: item.id,
              address: agentId,
            })
      }
    const history: HelperHistory[] = []
    for (const task of known.values()) {
      try {
        const { thread } = await rpc.request('thread/read', { threadId: task.agentId, includeTurns: true })
        if (!thread || thread.id !== task.agentId)
          throw new Error('The provider has no saved transcript for this helper.')
        const events: AgentEvent[] = []
        replayCodexAgent(task.agentId, thread.turns ?? [], (event) => events.push(event))
        const last = thread.turns?.at(-1)
        const status =
          task.status !== 'running'
            ? task.status
            : last?.status === 'completed'
              ? 'completed'
              : last?.status === 'failed'
                ? 'failed'
                : 'stopped'
        history.push({
          task: { ...task, status, ...(last?.error?.message ? { error: String(last.error.message) } : {}) },
          events,
        })
      } catch (error) {
        history.push({ task, events: [], error: String(error) })
      }
    }
    return history
  } finally {
    await rpc.close()
  }
}

/**
 * A side question answered on a throwaway fork of a Codex thread: it sees the whole conversation, can only read,
 * asks nothing, and the original thread is never touched.
 */
export async function codexAside(options: {
  accountId?: string
  threadId: string
  cwd: string
  model?: string
  effort?: string | null
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<string> {
  const rpc = new CodexRpc(undefined, [], options.accountId ?? 'default')
  const abort = () => void rpc.close()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    let fork = '',
      answer = ''
    let finish!: (error?: Error) => void
    const done = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve())
    })
    rpc.onExit = (error) => finish(error)
    rpc.onMessage = (m) => {
      // Nothing may be asked of the user here: every request is declined.
      if (m.id !== undefined && m.method) {
        rpc.write({ id: m.id, error: { code: -32601, message: 'Not available in a side question' } })
        return
      }
      const p = m.params ?? {}
      if (!fork || p.threadId !== fork) return
      if (m.method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.text) answer = p.item.text
      if (m.method === 'turn/completed')
        finish(
          p.turn?.status === 'failed' ? new Error(p.turn?.error?.message || 'The side question failed') : undefined,
        )
    }
    await rpc.initialize()
    const forkThread = () =>
      rpc.request('thread/fork', {
        threadId: options.threadId,
        ephemeral: true,
        excludeTurns: true,
        cwd: options.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ...(options.model ? { model: options.model } : {}),
      })
    // A thread archived in the Codex app or CLI cannot be forked until it is unarchived.
    const forked = await forkThread().catch(async (e: Error) => {
      if (!/is archived|codex unarchive/i.test(e.message)) throw e
      await rpc.request('thread/unarchive', { threadId: options.threadId })
      return forkThread()
    })
    fork = forked.thread.id
    await rpc.request('turn/start', {
      threadId: fork,
      input: [{ type: 'text', text: options.prompt }],
      cwd: options.cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
    })
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      done,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The side question timed out')), options.timeoutMs ?? 120_000)
      }),
    ]).finally(() => clearTimeout(timer))
    if (!answer.trim()) throw new Error('No answer came back')
    return answer.trim()
  } finally {
    options.signal?.removeEventListener('abort', abort)
    await rpc.close()
  }
}

/** How full Codex's context is: the tokens of the last request against the model's window. */
export function codexContext(usage: Wire | null | undefined): { used: number; max: number } | null {
  const used = usage?.last?.totalTokens,
    max = usage?.modelContextWindow
  return typeof used === 'number' && typeof max === 'number' && max > 0 ? { used, max } : null
}

/** One model call's input and output tokens; input includes cached reads. */
export function codexLast(usage: Wire | null | undefined): { input: number; output: number } | null {
  const input = usage?.last?.inputTokens,
    output = usage?.last?.outputTokens
  return typeof input === 'number' && typeof output === 'number' && input >= 0 && output >= 0 ? { input, output } : null
}

/** Codex's rate-limit windows as usage readings: the 5-hour window and the weekly one, told apart by their length. */
export function codexReadings(snapshot: Wire | null | undefined, now = Date.now()): UsageReading[] {
  if (!snapshot) return []
  const reached = !!snapshot.rateLimitReachedType
  return (['primary', 'secondary'] as const).flatMap((key): UsageReading[] => {
    const window = snapshot[key]
    if (!window || typeof window.usedPercent !== 'number') return []
    const minutes =
      typeof window.windowDurationMins === 'number' ? window.windowDurationMins : key === 'primary' ? 300 : 10080
    const usedPercent = Math.max(0, Math.min(100, Math.round(window.usedPercent)))
    return [
      {
        provider: 'codex',
        window: minutes <= 720 ? 'five_hour' : 'weekly',
        usedPercent,
        ...(typeof window.resetsAt === 'number' ? { resetsAt: window.resetsAt * 1000 } : {}),
        status: usedPercent >= 100 || (reached && usedPercent >= 95) ? 'limited' : usedPercent >= 80 ? 'warning' : 'ok',
        ...(snapshot.planType ? { plan: String(snapshot.planType) } : {}),
        updatedAt: now,
      },
    ]
  })
}

/**
 * Codex asks Ramu's own tool before one of its sub-agents starts. `input` is filled in from the hook payload; the call
 * also carries the Codex thread id, and Ramu's per-chat token says which chat it is.
 */
export const CODEX_HOOK_CONFIG =
  'hooks.PreToolUse=[{matcher="spawn_agent",hooks=[{type="mcp_tool",server="ramu",tool="codex_pre_tool_use",input={tool_name="${tool_name}",tool_input="${tool_input}",session_id="${session_id}"}}]}]'

/** The hook the app-server reports for Ramu's definition, with the key and hash its trust entry is stored under. */
async function ramuHook(rpc: CodexRpc, cwd: string): Promise<{ key: string; hash: string; trusted: boolean } | null> {
  const result = await rpc.request('hooks/list', { cwds: [cwd] })
  const hook = (result.data?.[0]?.hooks ?? []).find(
    (entry: Wire) =>
      entry.source === 'sessionFlags' && entry.handlerType === 'mcpTool' && entry.tool === 'codex_pre_tool_use',
  )
  return hook
    ? {
        key: hook.key,
        hash: hook.currentHash,
        trusted: hook.trustStatus === 'trusted' || hook.trustStatus === 'managed',
      }
    : null
}

/** Whether Codex trusts Ramu's hook, and with `grant`, writes the trust entry into Codex's user config so it does. */
export async function codexHookTrust(grant: boolean, cwd = tmpdir()): Promise<{ trusted: boolean; error?: string }> {
  const rpc = new CodexRpc(undefined, [CODEX_HOOK_CONFIG, 'mcp_servers.ramu.url="http://127.0.0.1:1/mcp"'])
  try {
    await rpc.initialize()
    let hook = await ramuHook(rpc, cwd)
    if (!hook) return { trusted: false, error: 'This version of Codex does not report hooks.' }
    if (!hook.trusted && grant) {
      // The same entry Codex's own review writes: the hash of exactly this definition.
      await rpc.request('config/batchWrite', {
        edits: [{ keyPath: `hooks.state."${hook.key}".trusted_hash`, mergeStrategy: 'replace', value: hook.hash }],
        reloadUserConfig: true,
      })
      hook = await ramuHook(rpc, cwd)
    }
    return { trusted: !!hook?.trusted }
  } catch (error) {
    return { trusted: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rpc.close()
  }
}

function codexAgentStatus(value: unknown): 'running' | 'completed' | 'failed' | 'stopped' {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  if (/error|fail/i.test(text)) return 'failed'
  if (/interrupt|cancel|stop|kill|shutdown|closed|notfound/i.test(text)) return 'stopped'
  if (/complete|done|finish|idle/i.test(text)) return 'completed'
  return 'running'
}

/** Codex items that are tool calls but not commands, edits or MCP calls. */
export function toolOfOtherItem(
  item: Wire,
): { name: string; summary: string; result: string; title?: string; content?: AgentContent[] } | null {
  if (item.type === 'webSearch') {
    const action = item.action ?? {}
    if (action.type === 'openPage')
      return {
        name: 'WebFetch',
        summary: String(action.url ?? item.query ?? ''),
        result: String(action.url ?? 'Opened page'),
      }
    if (action.type === 'findInPage')
      return {
        name: 'WebFetch',
        summary: `${action.pattern ?? ''} in ${action.url ?? 'page'}`.trim(),
        result: String(action.url ?? 'Searched in page'),
      }
    const query = String(action.query ?? item.query ?? '')
    return { name: 'WebSearch', summary: query, result: query ? `Searched: ${query}` : 'Searched the web' }
  }
  if (item.type === 'imageView')
    return {
      name: 'Read',
      title: 'View image',
      summary: String(item.path ?? ''),
      result: String(item.path ?? 'Viewed image'),
      content: [{ type: 'image', mimeType: 'image/png', uri: String(item.path ?? '') }],
    }
  if (item.type === 'dynamicToolCall')
    return {
      name: String(item.tool ?? 'Tool'),
      summary: item.arguments ? JSON.stringify(item.arguments).slice(0, 200) : '',
      result: JSON.stringify(item.contentItems ?? item.success ?? '').slice(0, 2000),
      ...(Array.isArray(item.contentItems) ? { content: agentContent(item.contentItems) } : {}),
      ...(typeof item.description === 'string' ? { title: item.description } : {}),
    }
  if (item.type === 'collabAgentToolCall')
    return { name: 'Agent', summary: String(item.tool ?? item.prompt ?? ''), result: String(item.status ?? '') }
  return null
}

/** Patch notifications replace the snapshot; they are not text deltas. */
function patchSummary(changes: Wire[]): string {
  return changes
    .filter((change) => typeof change?.path === 'string')
    .map(
      (change) =>
        `${change.path}${change.kind?.type ? ` (${change.kind.type})` : ''}\n${typeof change.diff === 'string' ? change.diff : ''}`,
    )
    .join('\n\n')
    .slice(0, 256_000)
}
