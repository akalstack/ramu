import { modelLegacyMetadata } from './modelLifecycle'
import { modelContextWindow } from './modelContext'
// Cursor chats through the official TypeScript SDK (`@cursor/sdk`), running the agent loop locally in this process.
// The SDK has no approval callback: full access runs unsandboxed, other access levels run in Cursor's sandbox.
import { cursorMcpServers, sessionMcpServers, configuredMcpStatus } from './discoveredMcp'
import type { AgentOptions, ModelSelection, Run, RunResult, SDKAgent, SDKMessage } from '@cursor/sdk'
import type {
  AgentEvent,
  AgentModel,
  AgentScope,
  AgentSettings,
  AgentToolKind,
  Attachment,
  McpConnection,
} from '@ramu/shared/types'
import { ResumeUnavailable, type AgentRunner, type AgentRunnerFactory } from '../agent/agentRunner'
import { attachmentPrompt } from '../attachments'
import { providerEnvironment } from './providerBinaries'
import { storedCursorKey } from './cursorAuth'
import { classifyLimit, limitSignal } from './limitClassifier'
import { limitedReading } from './usageLimit'

type Sdk = Pick<typeof import('@cursor/sdk'), 'Agent' | 'Cursor' | 'FileCredentialStore'>
type Wire = Record<string, any>

/** Loaded on first use: the SDK is large and only Cursor chats need it. */
export const loadCursorSdk = (): Promise<Sdk> => import('@cursor/sdk')

/**
 * The API key for an account: one set in its environment, else the login saved in its own folder. The default account
 * returns none and lets the SDK use its stored login (`Cursor.auth.login`).
 */
export const cursorApiKey = (accountId?: string): string | undefined => {
  const env = providerEnvironment('cursor', undefined, accountId ?? 'default')
  return env.CURSOR_API_KEY || (env.RAMU_CURSOR_SDK_DIR ? storedCursorKey(env) : undefined) || undefined
}

/** Ramu's model id as the SDK's selection. Cursor's router needs `optimize_for`, so "auto" asks for a balanced pick. */
export function cursorModel(id: string | undefined): ModelSelection {
  return !id || id === 'auto' || id === 'auto-smart'
    ? { id: 'auto-smart', params: [{ id: 'optimize_for', value: 'balanced' }] }
    : { id }
}

/** The account's model catalog from Cursor's API. */
export async function cursorModels(accountId?: string, sdk?: Sdk): Promise<AgentModel[]> {
  const { Cursor } = sdk ?? (await loadCursorSdk())
  const apiKey = cursorApiKey(accountId)
  const models = await Cursor.models.list(apiKey ? { apiKey } : {})
  return models.map((m, index) => ({
    provider: 'cursor',
    id: m.id,
    name: m.displayName || m.id,
    ...modelLegacyMetadata(m),
    ...(modelContextWindow(m) ? { contextWindow: modelContextWindow(m) } : {}),
    efforts: [],
    defaultEffort: null,
    isDefault: m.id === 'auto-smart' || (index === 0 && !models.some((x) => x.id === 'auto-smart')),
  }))
}

const KINDS: Record<string, AgentToolKind> = {
  shell: 'execute',
  read: 'read',
  edit: 'edit',
  write: 'edit',
  delete: 'delete',
  grep: 'search',
  glob: 'search',
  ls: 'search',
  semSearch: 'search',
  webFetch: 'fetch',
  webSearch: 'fetch',
}
const summaryOf = (args: unknown): string => {
  const a = (args && typeof args === 'object' ? args : {}) as Wire
  return String(a.command ?? a.path ?? a.filePath ?? a.pattern ?? a.query ?? a.url ?? a.description ?? '')
}
const json = (value: unknown, max: number): string => {
  try {
    return (typeof value === 'string' ? value : JSON.stringify(value, null, 2)).slice(-max)
  } catch {
    return ''
  }
}

export const createCursorRunner: AgentRunnerFactory = (scope, settings, emit, readOnly) =>
  new CursorSession(scope, settings, emit, readOnly)

export class CursorSession implements AgentRunner {
  readonly canSteer = true
  /** `run.steer` adds to the running turn; when it cannot, the message waits for the turn to end. */
  readonly steerInterrupts = false
  private connection?: McpConnection
  private agent?: SDKAgent
  private run?: Run
  private active?: Promise<void>
  private stopped = false
  private cancelled = false
  private text = new Map<string, string>()
  private segment = 0
  private lastKind: 'text' | 'thinking' | 'tool' | undefined
  private tools = 0

  constructor(
    private scope: AgentScope,
    private settings: AgentSettings,
    private emit: (event: AgentEvent, limit?: boolean | 'low') => void,
    private readOnly = false,
    private sdk?: Sdk,
  ) {}

  setTools(connection: McpConnection): void {
    this.connection = connection
  }

  async mcpStatus() {
    return configuredMcpStatus(this.scope, this.connection)
  }

  /** Not persisted by the SDK, so they go with every create, resume and send. */
  private mcpServers(): AgentOptions['mcpServers'] {
    return this.connection
      ? {
          ...(cursorMcpServers(
            sessionMcpServers(this.scope, this.connection, 'cursor', this.settings.accountId),
          ) as NonNullable<AgentOptions['mcpServers']>),
          ramu: {
            type: 'http',
            url: this.connection.url,
            headers: { Authorization: `Bearer ${this.connection.token}` },
          },
        }
      : undefined
  }

  private options(): AgentOptions {
    const apiKey = cursorApiKey(this.settings.accountId)
    return {
      ...(apiKey ? { apiKey } : {}),
      model: cursorModel(this.settings.model),
      local: {
        cwd: this.scope.cwd,
        autoReview: this.settings.access === 'auto' && !this.readOnly && !this.connection?.restricted,
        ...(this.scope.additionalDirs.length ? { dirs: this.scope.additionalDirs } : {}),
        settingSources: ['project', 'user'],
        // Without approvals, only full access may write outside the workspace or use the network.
        ...(this.settings.access !== 'full' || this.readOnly ? { sandboxOptions: { enabled: true } } : {}),
      },
      ...(this.mcpServers() ? { mcpServers: this.mcpServers() } : {}),
      ...(this.readOnly ? { tools: ['read', 'grep', 'glob', 'ls', 'semSearch'], mode: 'plan' as const } : {}),
      // Ramu routes sub-agents elsewhere: Cursor's own task tool is off.
      ...(this.connection?.nativeSubagents === false ? { disallowedTools: ['task'] } : {}),
    }
  }

  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    const { Agent } = this.sdk ?? (await loadCursorSdk())
    if (resume) {
      try {
        this.agent = await Agent.resume(resume, this.options())
      } catch (e) {
        throw new ResumeUnavailable(`Cursor no longer has this agent: ${(e as Error).message}`)
      }
    } else this.agent = await Agent.create(this.options())
    this.emit({
      kind: 'init',
      mcpServers: configuredMcpStatus(this.scope, this.connection, true, {
        provider: 'cursor',
        accountId: this.settings.accountId,
      }).servers,
      cwd: this.scope.cwd,
      model: this.settings.model || 'auto',
      providerSessionId: this.agent.agentId,
    })
    await this.send(prompt, attachments)
  }

  async send(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (this.active) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    if (!this.agent || this.stopped) throw new Error('Cursor session is not running')
    this.text.clear()
    this.segment = 0
    this.lastKind = undefined
    this.tools = 0
    this.cancelled = false
    this.emit({ kind: 'state', state: 'running' })
    const mcpServers = this.mcpServers()
    let run: Run
    try {
      run = await this.agent.send(attachmentPrompt(prompt, attachments), mcpServers ? { mcpServers } : undefined)
    } catch (e) {
      this.finish(undefined, (e as Error).message)
      return
    }
    this.run = run
    this.active = this.consume(run)
  }

  private async consume(run: Run): Promise<void> {
    let error: string | undefined
    let result: RunResult | undefined
    try {
      for await (const message of run.stream()) if (!this.stopped) this.handle(message)
      result = await run.wait()
    } catch (e) {
      error = (e as Error).message
    }
    this.active = undefined
    this.run = undefined
    this.finish(result, error)
  }

  private finish(result: RunResult | undefined, thrown?: string): void {
    if (this.stopped) return
    const reply = [...this.text.entries()]
      .filter(([key]) => key.startsWith('text:'))
      .map(([, text]) => text)
      .join('\n')
      .trim()
    const failed = thrown ?? (result?.status === 'error' ? result.error?.message || 'Cursor failed' : undefined)
    const cancelled = this.cancelled || result?.status === 'cancelled'
    const match = failed
      ? classifyLimit(failed, { provider: 'cursor', channel: 'error' })
      : cancelled
        ? null
        : classifyLimit(reply, { provider: 'cursor', channel: 'reply', toolCalls: this.tools })
    if (match?.confidence === 'high')
      this.emit({ kind: 'usage', readings: [limitedReading(this.settings, failed ?? reply)] })
    this.emit(
      {
        kind: 'result',
        isError: !!failed || !!match,
        text: failed ?? (match ? reply : cancelled ? 'cancelled' : 'end_turn'),
        costUsd: null,
      },
      limitSignal(match),
    )
  }

  /** The stream sends text and reasoning in pieces; a tool call between pieces starts a new message. */
  private grow(kind: 'text' | 'thinking', piece: string): void {
    if (this.lastKind === 'tool' || (this.lastKind && this.lastKind !== kind)) this.segment++
    this.lastKind = kind
    const key = `${kind}:${this.segment}`
    const text = (this.text.get(key) ?? '') + piece
    this.text.set(key, text)
    this.emit({ kind, text, messageId: `${this.run?.id ?? ''}:${key}` })
  }

  private handle(message: SDKMessage): void {
    if (message.type === 'assistant') {
      for (const block of message.message.content)
        if (block.type === 'text' && block.text) this.grow('text', block.text)
    } else if (message.type === 'thinking') {
      if (message.text) this.grow('thinking', message.text)
    } else if (message.type === 'tool_call') {
      this.lastKind = 'tool'
      if (message.status === 'running') {
        this.tools++
        this.emit({
          kind: 'tool-use',
          toolUseId: message.call_id,
          name: message.name,
          summary: summaryOf(message.args) || message.name,
          toolKind: KINDS[message.name] ?? 'other',
          input: json(message.args ?? {}, 256_000),
          status: 'in_progress',
        })
      } else
        this.emit({
          kind: 'tool-result',
          toolUseId: message.call_id,
          isError: message.status === 'error',
          summary: json(message.result ?? '', 64_000),
          status: message.status === 'error' ? 'failed' : 'completed',
        })
    } else if (message.type === 'status' && message.status === 'ERROR' && message.message)
      this.emit({ kind: 'error', message: message.message })
  }

  async steer(prompt: string, attachments: Attachment[] = []): Promise<void> {
    const run = this.run
    if (!run || this.stopped) throw new Error('There is no running turn to steer')
    const outcome = run.steer && run.supports('stream') ? await run.steer(attachmentPrompt(prompt, attachments)) : null
    if (outcome === 'complete_delivered') return
    // Not taken into the running turn: it becomes the next one.
    await this.active
    await this.send(prompt, attachments)
  }

  async interrupt(): Promise<void> {
    if (!this.run) return
    this.cancelled = true
    await this.run.cancel().catch(() => {})
    await this.active
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.run?.cancel().catch(() => {})
    this.agent?.close()
  }

  replyPermission(): void {
    throw new Error('Cursor does not ask for approvals.')
  }

  replyQuestion(): void {
    throw new Error('Cursor does not ask questions through Ramu.')
  }
}
