import { mcpCallSkipsCard, selfGatedRamuTool, type McpCallServer } from '../agent/toolApprovals'
import { ownedEnvironment, trackProcess } from '../agent/processOwners'
import { modelLegacyMetadata } from './modelLifecycle'
import { modelContextWindow } from './modelContext'
// Native OpenCode, Cursor and Google Antigravity ACP runtimes; JSON-RPC 2.0, newline framing.
import { acpMcpServers, sessionMcpServers, configuredMcpStatus } from './discoveredMcp'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { SelectionTransition } from './selectionTransition'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { providerAdapter } from './adapters'
import { createInterface } from 'node:readline'
import { AcpEvents, nativeShell } from './acpEvents'
import { productionDeploy } from '../agent/dangerousCommands'
import type {
  AgentEvent,
  AgentModel,
  ReasoningEffort,
  AgentScope,
  AgentSettings,
  Attachment,
  ElicitationAction,
  McpConnection,
} from '@ramu/shared/types'
import { permissionKey } from '../agent/permissionApprovals'
import { ramuTool } from '@ramu/shared/chat/ramuTools'
import { providerName } from '@ramu/shared/providers/providers'
import { attachmentPrompt } from '../attachments'
import { elicitationContent, elicitationRequest } from '../agent/elicitation'
import { classifyLimit, limitSignal } from './limitClassifier'
import { limitedReading } from './usageLimit'
import { noteRuntimeTransports } from './runtimeTransports'
import { exitReason, recordOutput } from './exitReason'
import { ACP_TERMINAL_METHODS, type AcpTerminalHost } from './acpTerminals'
import type { AgentRunner, AgentRunnerFactory } from '../agent/agentRunner'

/** How long a cancelled turn may take to end before steering or interrupting gives up. */
const cancelWaitMs = () => Number(process.env.RAMU_ACP_CANCEL_WAIT_MS) || 15_000
/**
 * How long a turn may go without any output before Ramu ends it. Antigravity can stop answering a prompt without
 * ending it; the clock holds while a tool runs or the agent waits on the person.
 */
const silentTurnMs = (provider: string) =>
  provider === 'antigravity' ? Number(process.env.RAMU_ACP_SILENT_TURN_MS) || 15 * 60_000 : 0
type Wire = Record<string, any>
/** OpenCode chats run on `opencode serve`; its `opencode acp` server only lists models. */
/**
 * The folders an ACP agent may use beyond its working directory. Antigravity refuses any path outside the folders it is
 * given ("outside the allowed workspace directories"), while Claude and Codex read the whole machine in Auto and Full
 * access. Those levels give Antigravity the home folder too, so it can read other projects and configuration the same
 * way; writing there still passes its own safety review and Ramu's approvals. Edits and read-only chats stay in scope.
 */
export function reachableDirectories(
  settings: Pick<AgentSettings, 'provider' | 'access'>,
  additionalDirs: readonly string[],
  readOnly: boolean,
  home = homedir(),
): string[] {
  const wide =
    settings.provider === 'antigravity' && !readOnly && (settings.access === 'auto' || settings.access === 'full')
  return wide && !additionalDirs.includes(home) ? [...additionalDirs, home] : [...additionalDirs]
}

type AcpProvider = 'cursor' | 'antigravity' | 'opencode'

/**
 * A runtime with no read-only mode can still run background analysis in a mode that sends every edit and command to
 * the client for approval, since a read-only session refuses them all. Antigravity lists none of ask, plan or
 * read-only; its `default` mode asks before each edit and command (`auto_edit` and `yolo` are the ones that skip it).
 */
const APPROVAL_MODES: Partial<Record<AcpProvider, string>> = { antigravity: 'default' }
/** Trust qualified tool identities, never arguments or a command's descriptive title. */
function isRamuCall(call: Wire | undefined, provider: AcpProvider): boolean {
  if (!call) return false
  const structured = call._meta?.claudeCode?.toolName ?? call.rawInput?._toolName ?? call.name
  const name =
    structured ??
    (provider === 'antigravity' && (!call.kind || call.kind === 'other')
      ? /^(?:Run )?([\w]+)\??$/.exec(call.title ?? '')?.[1]
      : undefined)
  return typeof name === 'string' && !!ramuTool({ name: name.replace(/^mcp_ramu_/, 'mcp__ramu__'), summary: '' })
}

/**
 * The Ramu or Shared MCP tool a permission request is for, from the same qualified identities isRamuCall trusts (and
 * Antigravity's bare `Run <tool>?` title for Ramu tools). Its arguments only say which tool a tool_invoke call runs.
 */
function acpMcpCall(
  call: Wire | undefined,
  provider: AcpProvider,
): { server: McpCallServer; tool: string; input?: Wire } {
  if (!call) return { server: 'other', tool: '' }
  const structured = call._meta?.claudeCode?.toolName ?? call.rawInput?._toolName ?? call.name
  const input = call.rawInput && typeof call.rawInput === 'object' ? (call.rawInput as Wire) : undefined
  // A single-underscore or bare name could belong to another server whose name starts with ramu, so it only counts
  // for a tool Ramu knows; `mcp__ramu__` names the server exactly.
  const known = (tool: string | undefined) =>
    tool && (ramuTool({ name: `mcp__ramu__${tool}`, summary: '' }) || selfGatedRamuTool(tool, input))
      ? { server: 'ramu' as const, tool, input }
      : undefined
  if (typeof structured === 'string') {
    const shared = /^mcp_{1,2}shared_mcp_{1,2}(.+)$/.exec(structured)?.[1]
    if (shared) return { server: 'shared_mcp', tool: shared, input }
    const exact = /^mcp__ramu__(.+)$/.exec(structured)?.[1]
    if (exact) return { server: 'ramu', tool: exact, input }
    return known(/^(?:mcp_)?ramu_(.+)$/.exec(structured)?.[1]) ?? { server: 'other', tool: structured }
  }
  const titled =
    provider === 'antigravity' && (!call.kind || call.kind === 'other')
      ? /^(?:Run )?(?:mcp_ramu_)?([\w]+)\??$/.exec(call.title ?? '')?.[1]
      : undefined
  return known(titled) ?? { server: 'other', tool: '' }
}

export function acpCommand(provider: AcpProvider, env: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const command = providerBinary(provider)
  return { command, args: providerAdapter(provider).launchArgs?.(command, env) ?? ['acp'] }
}
export { ResumeUnavailable as AcpResumeUnavailable } from '../agent/agentRunner'
import { ResumeUnavailable as AcpResumeUnavailable } from '../agent/agentRunner'
/** Events that mean the runtime is still working after it answered the prompt. */
const LATE_WORK = new Set<AgentEvent['kind']>(['tool-use', 'tool-result', 'text', 'thinking'])
/** How long a runtime that kept working after its reply must stay quiet before the turn counts as done. */
const LATE_QUIET_MS = 4000

export class AcpRpc {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private closed = false
  private stopping = false
  private pending = new Map<
    number,
    { resolve: (r: Wire) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }
  >()
  private readonly output: { last(): string }
  readonly exited: Promise<void>
  onMessage: (message: Wire) => void = () => {}
  onExit: (error: Error) => void = () => {}
  constructor(
    private provider: AcpProvider,
    cwd: string,
    accountId?: string,
  ) {
    const env = ownedEnvironment(providerEnvironment(provider, undefined, accountId, cwd))
    const { command, args } = acpCommand(provider, env)
    this.child = trackProcess(spawn(command, args, { cwd, stdio: 'pipe', env }))
    const output = recordOutput(this.child.stderr)
    this.output = output
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
      // `close` waits for stdout to drain, so a last reply written just before the runtime exits is still read.
      this.child.once('close', (code, signal) =>
        finish(new Error(exitReason(`${providerName(provider)} ACP runtime`, code, signal, output.last()))),
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
            const said = this.output.last()
            reject(
              new Error(`${providerName(this.provider)} ${method} timed out.${said ? ` Last output: ${said}` : ''}`),
            )
          }, timeoutMs)
        : undefined
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }
  /** Advertised only when the session was given a terminal host; set before `initialize`. */
  terminal = false
  /**
   * `signIn` is for work the person started, such as a thread: Cursor's CLI then signs in, opening the browser when it
   * holds no login. Background work (listing models, a side question) passes false, so it never opens a sign-in page.
   */
  async initialize(signIn = true): Promise<Wire> {
    const result = await this.request(
      'initialize',
      {
        protocolVersion: 1,
        // Antigravity offers its Claude and GPT models only to allowlisted clients such as Zed; everyone else gets Gemini.
        clientInfo:
          this.provider === 'antigravity' ? { name: 'zed', version: '0.0.0' } : { name: 'ramu', version: '0.0.1' },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: this.terminal,
          session: { compaction: {} },
        },
      },
      // Antigravity's runtime compiles on its first start, which takes minutes on a slow or Intel Mac.
      this.provider === 'antigravity' ? 5 * 60_000 : undefined,
    )
    if (result.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version')
    if (signIn && this.provider === 'cursor') await this.request('authenticate', { methodId: 'cursor_login' })
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
const effortsOf = (level: Wire | undefined) => {
  const efforts = level
    ? optionsOf(level)
        .map((o) => o.value as ReasoningEffort)
        .filter((value) => EFFORTS.includes(value))
    : []
  return {
    efforts,
    defaultEffort: efforts.includes(level?.currentValue) ? (level!.currentValue as ReasoningEffort) : null,
  }
}
/**
 * `levels` holds the reasoning option each model showed once selected (`undefined` when it has none). Without it, the
 * session-wide option stands for every model.
 */
export function acpSessionModels(
  provider: AcpProvider,
  session: Wire,
  levels?: Map<string, Wire | undefined>,
): AgentModel[] {
  const config = (session.configOptions ?? []).find((c: Wire) => c.category === 'model' || c.id === 'model')
  const models: Wire[] = config
    ? optionsOf(config).map((m) => ({ ...m, id: m.value, name: m.name }))
    : (session.models?.availableModels ?? []).map((m: Wire) => ({ ...m, id: m.modelId, name: m.name }))
  const current = config?.currentValue ?? session.models?.currentModelId
  // ACP exposes reasoning as one session-wide option; only levels Ramu understands can be offered.
  const shared = effortsOf(effortConfig(session))
  return models.map((m) => ({
    provider,
    id: m.id,
    name: m.name || m.id,
    ...modelLegacyMetadata(m),
    ...(modelContextWindow(m) ? { contextWindow: modelContextWindow(m) } : {}),
    ...(levels?.has(m.id) ? effortsOf(levels.get(m.id)) : shared),
    isDefault: m.id === current,
  }))
}
/** What each ACP login last said about its plan (Antigravity's quota tier), by provider and account. */
const acpPlans = new Map<string, { plan: string; upgradeUrl?: string }>()
const planListeners = new Set<(provider: AcpProvider, accountId: string) => void>()
export const acpPlan = (provider: AcpProvider, accountId = 'default') => acpPlans.get(`${provider}:${accountId}`)
/** Hears a login's plan change, so its models and usage can be read again. */
export function onAcpPlanChange(listener: (provider: AcpProvider, accountId: string) => void): () => void {
  planListeners.add(listener)
  return () => planListeners.delete(listener)
}
/** Notes the plan a new or resumed session reports; a different plan than before tells the listeners. */
export function observeAcpPlan(provider: AcpProvider, accountId: string, session: Wire): void {
  const tier = session?._meta?.antigravity?.tier
  if (!tier || typeof tier.name !== 'string' || !tier.name.trim()) return
  const upgrade = typeof tier.upgradeUri === 'string' && tier.upgradeUri.startsWith('https://') ? tier.upgradeUri : ''
  const key = `${provider}:${accountId}`
  const before = acpPlans.get(key)
  acpPlans.set(key, { plan: tier.name.trim(), ...(upgrade ? { upgradeUrl: upgrade } : {}) })
  if (before && before.plan !== tier.name.trim()) for (const listener of planListeners) listener(provider, accountId)
}
/** Antigravity's thinking levels belong to Gemini alone, so each model is selected once on the throwaway session to read its own. */
async function modelLevels(rpc: AcpRpc, session: Wire): Promise<Map<string, Wire | undefined>> {
  const config = (session.configOptions ?? []).find((c: Wire) => c.category === 'model' || c.id === 'model')
  const levels = new Map<string, Wire | undefined>()
  if (!config) return levels
  levels.set(config.currentValue, effortConfig(session))
  for (const { value } of optionsOf(config)) {
    if (levels.has(value)) continue
    const changed = await rpc
      .request('session/set_config_option', { sessionId: session.sessionId, configId: config.id, value })
      .catch(() => null)
    if (Array.isArray(changed?.configOptions)) levels.set(value, effortConfig({ configOptions: changed.configOptions }))
  }
  return levels
}
export async function acpModels(provider: AcpProvider, accountId?: string): Promise<AgentModel[]> {
  const rpc = new AcpRpc(provider, homedir(), accountId)
  rpc.onMessage = (m) => {
    if (m.id !== undefined && m.method)
      rpc.write({ id: m.id, error: { code: -32601, message: 'Model discovery cannot run tools or answer questions' } })
  }
  try {
    // Model discovery runs when the app starts; a CLI without a login lists nothing rather than opening its sign-in.
    await rpc.initialize(false)
    const session = await rpc.request('session/new', { cwd: homedir(), mcpServers: [] })
    observeAcpPlan(provider, accountId ?? 'default', session)
    return acpSessionModels(provider, session, provider === 'antigravity' ? await modelLevels(rpc, session) : undefined)
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
    const init = await rpc.initialize(false)
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
export const createAcpRunner: AgentRunnerFactory = (scope, settings, emit, readOnly, onTitle) =>
  new AcpSession(scope, settings, emit, readOnly, onTitle)
class AcpSession implements AgentRunner {
  private rpc?: AcpRpc
  private sessionId = ''
  private connection?: McpConnection
  private active?: Promise<void>
  /**
   * Some runtimes answer the prompt and keep streaming tool calls and text. That work belongs to the turn, so the chat
   * shows it running until the late tool calls finish and the runtime has been quiet for a moment.
   */
  private late?: { tools: Set<string>; timer?: ReturnType<typeof setTimeout> }
  private stopped = false
  /** True while a cancelled turn is being replaced by a steering message, so its end is not reported as a finished turn. */
  private steering = false
  private turnText = new Map<string, string>()
  private turnTools = 0
  private seenTools = new Set<string>()
  readonly canSteer = true
  /** A runtime that advertises `_session/steering` takes input into the running turn; the rest cancel it and start over. */
  private nativeSteering = false
  private canResume?: boolean
  get steerInterrupts(): boolean {
    return !this.nativeSteering
  }
  private mcpHttp = true
  private loading = false
  private events: AcpEvents
  private pending = new Map<string, Wire>()
  /** When the running turn last showed progress, and the tools it has running, for the silence watchdog. */
  private progressAt = 0
  private runningTools = new Set<string>()
  private watchdog?: ReturnType<typeof setInterval>
  /** The runtime ended (it exited, or went silent and was closed): the next message starts it again on this session. */
  private relaunch = false
  private session: Wire = {}
  private prompts?: { image?: boolean }
  constructor(
    private scope: AgentScope,
    private settings: AgentSettings,
    private emit: (event: AgentEvent, limit?: boolean | 'low') => void,
    private readOnly = false,
    private onTitle?: (title: string) => void,
  ) {
    this.events = new AcpEvents(settings.provider === 'antigravity' ? ['invoke_subagent'] : ['task', 'subagent'])
  }
  setTools(connection: McpConnection): void {
    this.connection = connection
  }
  private terminals?: AcpTerminalHost
  setTerminals(host: AcpTerminalHost): void {
    this.terminals = host
  }
  async mcpStatus() {
    return configuredMcpStatus(this.scope, this.connection, this.mcpHttp)
  }

  planSettingsTransition(settings: AgentSettings): SelectionTransition {
    if (
      this.sessionId &&
      !this.loading &&
      settings.model &&
      settings.model !== this.settings.model &&
      !acpSessionModels(this.settings.provider as AcpProvider, this.session).some(
        (model) => model.id === settings.model,
      )
    )
      return { type: 'reject', reason: 'The selected model is unavailable in this ACP session' }
    return { type: this.canResume === false ? 'handoff' : 'restart-and-resume' }
  }

  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    const provider = this.settings.provider as AcpProvider
    this.rpc = new AcpRpc(provider, this.scope.cwd, this.settings.accountId ?? 'default')
    this.rpc.terminal = !!this.terminals
    this.rpc.onMessage = (m) => this.handle(m)
    this.rpc.onExit = (e) => {
      this.endWatch()
      if (!this.stopped) {
        this.relaunch = true
        this.emit({ kind: 'error', message: e.message })
        this.emit({ kind: 'state', state: 'failed' })
      }
    }
    const init = await this.rpc.initialize()
    const capabilities = init.agentCapabilities ?? {}
    this.canResume = !!(capabilities.sessionCapabilities?.resume || capabilities.loadSession)
    this.prompts = capabilities.promptCapabilities
    this.nativeSteering = init._meta?.steering?.supported === true
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
        `${providerName(provider)} does not support resuming this session. Start a new thread.`,
      )
    // HTTP MCP is optional in ACP. A runtime that lists its MCP support without HTTP cannot reach Ramu's tools, so say so instead of losing them silently.
    const mcp = capabilities.mcpCapabilities
    this.mcpHttp = mcp?.http === true || !mcp
    noteRuntimeTransports(provider, mcp)
    const tools = this.connection && !(mcp && mcp.http !== true) ? this.connection : undefined
    if (this.connection && !tools)
      this.emit({
        kind: 'error',
        message: `${providerName(provider)} cannot connect to Ramu's tools over HTTP, so the integrated browser, questions, helpers and advice are unavailable in this thread.`,
      })
    this.sessionId = resume ?? ''
    this.loading = true
    try {
      this.session = await this.rpc.request(method, {
        ...(resume ? { sessionId: resume } : {}),
        cwd: this.scope.cwd,
        additionalDirectories: reachableDirectories(this.settings, this.scope.additionalDirs, this.readOnly),
        mcpServers: [
          ...acpMcpServers(
            sessionMcpServers(
              this.scope,
              this.connection,
              this.settings.provider,
              this.settings.accountId,
              this.connection?.sharingProjectId,
            ),
            this.mcpHttp,
          ),
          ...(tools
            ? [
                {
                  type: 'http',
                  name: 'ramu',
                  url: tools.url,
                  headers: [{ name: 'Authorization', value: `Bearer ${tools.token}` }],
                },
              ]
            : []),
        ],
      })
      observeAcpPlan(provider, this.settings.accountId ?? 'default', this.session)
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
      const mode =
        modes.find((id: string) => id === 'ask' || id === 'plan' || id === 'read-only') ??
        modes.find((id: string) => id === APPROVAL_MODES[provider])
      if (!mode)
        throw new Error(`${providerName(provider)} does not advertise a read-only mode for background analysis`)
      await this.rpc.request(
        config ? 'session/set_config_option' : 'session/set_mode',
        config
          ? { sessionId: this.sessionId, configId: config.id, value: mode }
          : { sessionId: this.sessionId, modeId: mode },
      )
    }
    if (!this.readOnly && !this.connection?.restricted) {
      // Antigravity's native edit mode avoids permission prompts before they reach the client.
      const preferred =
        provider === 'antigravity'
          ? this.settings.access === 'edits'
            ? ['auto_edit']
            : this.settings.access === 'full'
              ? // Not yolo: commands must still reach Ramu so it can stop the dangerous few.
                ['auto_edit']
              : ['auto_edit', 'auto', 'default']
          : this.settings.access === 'auto'
            ? ['auto']
            : []
      for (const mode of preferred) {
        const config = (this.session.configOptions ?? []).find(
          (entry: Wire) =>
            (entry.category === 'mode' || /^(?:mode|approval_mode|permission_mode)$/.test(entry.id ?? '')) &&
            optionsOf(entry).some((option) => option.value === mode),
        )
        if (!config && !(this.session.modes?.availableModes ?? []).some((entry: Wire) => entry.id === mode)) continue
        await this.rpc.request(
          config ? 'session/set_config_option' : 'session/set_mode',
          config
            ? { sessionId: this.sessionId, configId: config.id, value: mode }
            : { sessionId: this.sessionId, modeId: mode },
        )
        break
      }
    }
    this.emit({
      kind: 'init',
      mcpServers: configuredMcpStatus(this.scope, this.connection, this.mcpHttp, {
        provider: this.settings.provider,
        accountId: this.settings.accountId,
      }).servers,
      cwd: this.scope.cwd,
      model:
        this.settings.model ||
        acpSessionModels(provider, this.session).find((m) => m.isDefault)?.id ||
        `${providerName(provider)} default`,
      providerSessionId: this.sessionId,
    })
    await this.send(prompt, attachments)
  }
  private promptBlocks(prompt: string, attachments: Attachment[]): Wire[] {
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
    return content
  }
  async send(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (this.active) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    if (this.relaunch && !this.stopped && this.sessionId) {
      // Continue the same session on a fresh runtime, as the thread would after a restart.
      this.relaunch = false
      return this.start(prompt, this.sessionId, attachments)
    }
    if (!this.rpc || this.stopped) throw new Error('ACP session is not running')
    this.endLateWork(false)
    this.events.beginTurn()
    this.turnText.clear()
    this.turnTools = 0
    this.seenTools.clear()
    const content = this.promptBlocks(prompt, attachments)
    this.emit({ kind: 'state', state: 'running' })
    this.watch()
    this.active = this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt: content }, 0).then(
      (r) => {
        this.endWatch()
        this.active = undefined
        this.cancelPending()
        if (this.stopped || this.steering) return
        // A runtime may report an exhausted quota as an ordinary reply, or as a refusal.
        const reply = [...this.turnText.values()].join('\n').trim()
        const match =
          classifyLimit(reply, { provider: this.settings.provider, channel: 'reply', toolCalls: this.turnTools }) ??
          (r.stopReason === 'refusal'
            ? classifyLimit(reply, { provider: this.settings.provider, channel: 'error' })
            : null)
        if (match) this.markLimited(reply, match.confidence)
        const tokens = acpTurnTokens(r.usage)
        this.emit(
          {
            kind: 'result',
            isError: !!match || r.stopReason === 'refusal',
            text: match ? reply : r.stopReason || 'end_turn',
            costUsd: null,
            ...(tokens ? { tokens } : {}),
          },
          limitSignal(match),
        )
      },
      (e: Error) => {
        this.endWatch()
        this.active = undefined
        this.cancelPending()
        if (this.stopped || this.steering) return
        const match = classifyLimit(e.message, { provider: this.settings.provider, channel: 'error' })
        if (match) this.markLimited(e.message, match.confidence)
        this.emit({ kind: 'result', isError: true, text: e.message, costUsd: null }, limitSignal(match))
      },
    )
  }
  /**
   * `_session/steering` adds the message to the running turn when the runtime offers it. Otherwise ACP has no way to add
   * input to a running turn, so steering cancels it and continues the same session with the new message.
   */
  async steer(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.active || !this.rpc || this.stopped) throw new Error('There is no running turn to steer')
    if (this.nativeSteering) {
      // An `injected` outcome continues the running prompt; any other outcome starts a turn the runtime reports itself.
      await this.rpc.request('_session/steering', {
        sessionId: this.sessionId,
        prompt: this.promptBlocks(prompt, attachments),
      })
      return
    }
    this.steering = true
    try {
      this.rpc.write({ method: 'session/cancel', params: { sessionId: this.sessionId } })
      this.cancelPending()
      await this.cancelled()
    } finally {
      this.steering = false
    }
    await this.send(prompt, attachments)
  }
  async interrupt(): Promise<void> {
    if (this.active) {
      this.rpc?.write({ method: 'session/cancel', params: { sessionId: this.sessionId } })
      this.cancelPending()
      await this.cancelled()
    }
  }
  /** Ends a turn that has shown nothing for too long, and closes its runtime so the next message starts a fresh one. */
  private watch(): void {
    const limit = silentTurnMs(this.settings.provider)
    this.endWatch()
    this.progressAt = Date.now()
    this.runningTools.clear()
    if (!limit) return
    this.watchdog = setInterval(
      () => {
        if (!this.active || this.stopped) return this.endWatch()
        // Waiting on the person or on a running tool is not silence.
        if (this.pending.size || this.runningTools.size) this.progressAt = Date.now()
        if (Date.now() - this.progressAt < limit) return
        this.endWatch()
        const minutes = Math.max(1, Math.round(limit / 60_000))
        this.active = undefined
        this.relaunch = true
        this.cancelPending()
        const rpc = this.rpc
        this.rpc = undefined
        void rpc?.close()
        this.emit({
          kind: 'result',
          isError: true,
          text: `${providerName(this.settings.provider as AcpProvider)} sent nothing for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, so Ramu stopped the turn and restarted the agent. Send a message to continue.`,
          costUsd: null,
        })
      },
      Math.min(30_000, Math.max(250, limit / 4)),
    )
    this.watchdog.unref?.()
  }
  private endWatch(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = undefined
  }
  /** Waits for a cancelled turn to end. A runtime that ignores `session/cancel` must not hang the caller. */
  private async cancelled(): Promise<void> {
    const active = this.active
    if (!active) return
    let timer: NodeJS.Timeout | undefined
    const gave = await Promise.race([
      active.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), cancelWaitMs())
        timer.unref()
      }),
    ]).finally(() => clearTimeout(timer))
    if (gave && this.active === active) throw new Error('The runtime did not stop the running turn. Try again.')
  }
  async stop(): Promise<void> {
    this.stopped = true
    this.endWatch()
    this.terminals?.dispose()
    this.cancelPending()
    await this.rpc?.close()
  }
  /** No usage API exists for these runtimes, so a limit response is recorded as a reading and routing avoids the provider until it lifts. */
  private markLimited(text: string, confidence: 'high' | 'low'): void {
    // A low-confidence match must not mark the provider limited: the caller retries once and decides.
    if (confidence !== 'high') return
    this.emit({ kind: 'usage', readings: [limitedReading(this.settings, text)] })
  }
  private cancelPending(): void {
    for (const [id, m] of this.pending) {
      this.rpc?.write({
        id: m.id,
        result: m.elicitation
          ? { action: 'cancel' }
          : { outcome: m.method.startsWith('cursor/') ? 'cancelled' : { outcome: 'cancelled' } },
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
  /** Why full access must still ask before this permission request's shell command, or null. */
  private fullAccessDanger(p: Wire): string | null {
    if (!p.toolCall?.rawInput) return null
    const tool = p.toolCall._meta?.claudeCode?.toolName || p.toolCall.rawInput?._toolName || p.toolCall.kind || ''
    if (!['execute', 'command', 'Bash', 'bash', 'run_command'].includes(tool)) return null
    const command = nativeShell(p.toolCall.rawInput, undefined)?.command
    return command ? productionDeploy(command) : null
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
  private lateWork(events: AgentEvent[]): void {
    if (!this.late) {
      this.late = { tools: new Set() }
      this.emit({ kind: 'state', state: 'running' })
    }
    const late = this.late
    for (const event of events) {
      if (event.kind === 'tool-use') late.tools.add(event.toolUseId)
      if (event.kind === 'tool-result' && !event.running) late.tools.delete(event.toolUseId)
    }
    clearTimeout(late.timer)
    late.timer = setTimeout(() => {
      if (this.late === late && !late.tools.size) this.endLateWork(true)
    }, LATE_QUIET_MS)
  }
  private endLateWork(settle: boolean): void {
    if (!this.late) return
    clearTimeout(this.late.timer)
    this.late = undefined
    if (settle && !this.stopped) this.emit({ kind: 'state', state: 'idle' })
  }
  private handle(m: Wire): void {
    if (this.stopped || !m.method) return
    const p = m.params ?? {}
    if (m.method === 'session/update') {
      if (p.sessionId !== this.sessionId) return
      const u = p.update ?? {}
      // Session metadata: a title the runtime chose. History replay while loading is ignored above, so only live updates count.
      // The runtime's full option set changed (its model list after a plan change, or the model's thinking levels).
      if (u.sessionUpdate === 'config_option_update' && Array.isArray(u.configOptions)) {
        this.session = { ...this.session, configOptions: u.configOptions }
        return
      }
      if (u.sessionUpdate === 'session_info_update') {
        if (!this.loading && typeof u.title === 'string' && u.title.trim()) this.onTitle?.(u.title)
        return
      }
      if (this.loading && !['compaction_update', 'compaction_summary_chunk', 'usage_update'].includes(u.sessionUpdate))
        return
      const events = this.events.consume(u)
      if (!this.active && !this.loading && events.some((event) => LATE_WORK.has(event.kind))) this.lateWork(events)
      // Output of the running turn resets the silence clock; session metadata above does not.
      if (events.length) this.progressAt = Date.now()
      for (const event of events) {
        if (event.kind === 'tool-use' && event.status !== 'completed' && event.status !== 'failed')
          this.runningTools.add(event.toolUseId)
        if (event.kind === 'tool-result') this.runningTools.delete(event.toolUseId)
        if (event.kind === 'text' && !event.agentId) this.turnText.set(event.messageId ?? '', event.text)
        if (event.kind === 'tool-use' && !event.agentId && !this.seenTools.has(event.toolUseId)) {
          this.seenTools.add(event.toolUseId)
          this.turnTools++
        }
        this.emit(event)
      }
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
              error: 'Sub-agents run through Ramu in this thread',
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
      } else if (this.readOnly || this.connection?.restricted) {
        // A review chat about learned memories may only use Ramu's own tools, which need no approval.
        this.replyPermission(id, false)
        return
      } else if (
        m.method !== 'cursor/create_plan' &&
        ((this.settings.access === 'full' && !this.fullAccessDanger(p)) ||
          (this.settings.access === 'auto' &&
            !!this.connection &&
            isRamuCall(p.toolCall, this.settings.provider as AcpProvider)) ||
          // The calls Ramu decides on the host need no card in any mode, the same way for every provider.
          (!!this.connection &&
            (({ server, tool, input }) => mcpCallSkipsCard(this.settings.access, server, tool, input))(
              acpMcpCall(p.toolCall, this.settings.provider as AcpProvider),
            )) ||
          (this.settings.access === 'edits' && p.toolCall?.kind === 'edit'))
      ) {
        this.replyPermission(id, true)
        return
      } else {
        const danger = this.settings.access === 'full' ? this.fullAccessDanger(p) : null
        this.emit({
          kind: 'permission-request',
          requestId: id,
          toolName: p.toolCall?._meta?.claudeCode?.toolName || p.toolCall?.kind || 'Plan',
          title: p.toolCall?.title || p.name || 'Approve plan?',
          ...(m.method === 'session/request_permission' &&
          p.toolCall?.rawInput &&
          Object.keys(p.toolCall.rawInput).length
            ? {
                approvalCommand: ['execute', 'command', 'Bash', 'bash', 'run_command'].includes(
                  p.toolCall?._meta?.claudeCode?.toolName || p.toolCall.rawInput?._toolName || p.toolCall?.kind || '',
                )
                  ? nativeShell(p.toolCall.rawInput, undefined)?.command
                  : undefined,
                approvalKey: permissionKey(
                  p.toolCall?._meta?.claudeCode?.toolName || p.toolCall?.kind || 'Tool',
                  p.toolCall.rawInput,
                ),
              }
            : {}),
          detail: p.plan || JSON.stringify(p.toolCall?.rawInput ?? {}),
          ...(this.settings.access === 'full'
            ? {
                approvalOnceOnly: true,
                ...(danger ? { approvalFullAccess: { reason: danger } } : {}),
              }
            : {}),
        })
      }
      this.emit({ kind: 'state', state: 'needs-input' })
      return
    }
    if (m.method === 'elicitation/create') {
      const id = String(m.id)
      if (this.readOnly) {
        this.rpc?.write({ id: m.id, result: { action: 'cancel' } })
        return
      }
      try {
        const elicitation = elicitationRequest(id, {
          serverName: p._meta?.serverName ?? providerName(this.settings.provider),
          ...p,
        })
        this.pending.set(id, { ...m, elicitation })
        this.emit({ kind: 'elicitation', ...elicitation })
        this.emit({ kind: 'state', state: 'needs-input' })
      } catch {
        // A form Ramu cannot render is declined rather than left waiting.
        this.rpc?.write({ id: m.id, result: { action: 'decline' } })
      }
      return
    }
    if (this.terminals && ACP_TERMINAL_METHODS.has(m.method)) {
      const rpc = this.rpc
      const requestId = m.id
      this.terminals.handle(m.method, p).then(
        (result) => rpc?.write({ id: requestId, result }),
        (error) =>
          rpc?.write({
            id: requestId,
            error: { code: -32602, message: error instanceof Error ? error.message : String(error) },
          }),
      )
      return
    }
    this.rpc?.write({ id: m.id, error: { code: -32601, message: `Unsupported client method: ${m.method}` } })
  }
  replyElicitation(id: string, action: ElicitationAction, answers: Record<string, string>): void {
    const m = this.pending.get(id)
    if (!m?.elicitation) throw new Error('That input request is no longer pending.')
    const content = action === 'accept' ? elicitationContent(m.elicitation, answers) : undefined
    this.pending.delete(id)
    this.rpc!.write({ id: m.id, result: { action, ...(content ? { content } : {}) } })
    this.emit({
      kind: 'request-resolved',
      requestId: id,
      outcome: action === 'accept' ? 'answered' : action === 'decline' ? 'declined' : 'cancelled',
    })
    if (!this.pending.size) this.emit({ kind: 'state', state: 'running' })
  }
}

/**
 * A turn's tokens from ACP's prompt response, which runtimes may include as the protocol's (still experimental) `usage`;
 * cached reads count as input, as Ramu records Claude and Codex turns. Absent or malformed usage records nothing.
 */
export function acpTurnTokens(usage: unknown): { input: number; output: number } | null {
  if (!usage || typeof usage !== 'object') return null
  const { inputTokens, outputTokens, cachedReadTokens } = usage as Record<string, unknown>
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
  const input = count(inputTokens),
    output = count(outputTokens)
  if (input === null || output === null) return null
  return { input: input + (count(cachedReadTokens) ?? 0), output }
}
