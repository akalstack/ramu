import { permissionKey } from '../agent/permissionApprovals'
// OpenCode 2 chats through its HTTP API (`@opencode/client`). Each chat runs its own `opencode serve`, so the
// account's config directories and the per-chat config (Ramu's tool server, skills, sub-agent switch) stay separate.
import { openCodeMcpServers, sessionMcpServers, configuredMcpStatus } from './discoveredMcp'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { OpenCode } from '@opencode/client'
import type {
  AgentEvent,
  AgentQuestion,
  AgentScope,
  AgentSettings,
  AgentToolKind,
  Attachment,
  McpConnection,
} from '@ramu/shared/types'
import { ResumeUnavailable, type AgentRunner, type AgentRunnerFactory } from '../agent/agentRunner'
import { openCodeConfigEnv } from './acp'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { classifyLimit, limitSignal } from './limitClassifier'
import { limitedReading } from './usageLimit'

type Wire = Record<string, any>
type Client = ReturnType<typeof OpenCode.make>
type Outcome = { error?: string; interrupted?: boolean }

/**
 * The chat's inline config: the user's own plus Ramu's skills and tool server. OpenCode 2 lists MCP servers under
 * `mcp.servers` and reads this per process, so nothing is written to the user's config or OpenCode's database. The
 * sub-agent switch is a session permission instead (see `openCodePermissions`).
 */
export function openCodeServerEnv(
  connection: McpConnection | undefined,
  existing = process.env.OPENCODE_CONFIG_CONTENT,
  repoServers: Record<string, Wire> = {},
): Record<string, string> {
  const skills = connection && { ...connection, nativeSubagents: undefined }
  const merged = openCodeConfigEnv(skills, existing).OPENCODE_CONFIG_CONTENT ?? existing
  let config: Wire = {}
  try {
    config = merged ? JSON.parse(merged) : {}
  } catch {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  const mcp = config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp) ? config.mcp : {}
  if (connection)
    config.mcp = {
      ...mcp,
      servers: {
        ...repoServers,
        ...(mcp.servers && typeof mcp.servers === 'object' ? mcp.servers : {}),
        ramu: {
          type: 'remote',
          url: connection.url,
          headers: { Authorization: `Bearer ${connection.token}` },
          // Questions and helpers can wait a long time for the user.
          timeout: { execution: 3_600_000 },
        },
      },
    }
  return Object.keys(config).length ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } : {}
}

/**
 * Session rules for the chosen access. Allow edits is an explicit native policy, independent of permissive user
 * defaults. Full access is OpenCode's own `"*": "allow"`: rules are evaluated last match first, and session rules come
 * after the user's config, so it also overrides their ask and deny rules. Auto (and anything else) adds nothing:
 * `permission.asked` approves what is emitted and explicit deny rules never reach it, like `opencode --auto`.
 */
export function openCodePermissions(connection: McpConnection | undefined, access?: AgentSettings['access']) {
  const rules: { action: string; resource: string; effect: 'allow' | 'deny' | 'ask' }[] =
    access === 'edits'
      ? [
          { action: '*', resource: '*', effect: 'ask' },
          { action: 'read', resource: '*', effect: 'allow' },
          { action: 'read', resource: '*.env', effect: 'ask' },
          { action: 'read', resource: '*.env.*', effect: 'ask' },
          { action: 'read', resource: '*.env.example', effect: 'allow' },
          ...['glob', 'grep', 'lsp', 'skill', 'todowrite', 'question'].map((action) => ({
            action,
            resource: '*',
            effect: 'allow' as const,
          })),
          { action: 'bash', resource: '*', effect: 'ask' },
          { action: 'edit', resource: '*', effect: 'allow' },
        ]
      : access === 'full'
        ? [{ action: '*', resource: '*', effect: 'allow' }]
        : []
  if (connection?.nativeSubagents === false) rules.push({ action: 'task', resource: '*', effect: 'deny' })
  return rules
}

/** `provider/model` as Ramu stores it; the model part may itself contain slashes. */
export function openCodeModel(
  id: string | undefined,
  effort?: string | null,
): { providerID: string; id: string; variant?: string } | undefined {
  const at = id?.indexOf('/') ?? -1
  // Ramu's effort levels come from OpenCode's own variants (see the catalog), so they pass through as the variant.
  return id && at > 0
    ? { providerID: id.slice(0, at), id: id.slice(at + 1), ...(effort ? { variant: effort } : {}) }
    : undefined
}

const KINDS: Record<string, AgentToolKind> = {
  shell: 'execute',
  bash: 'execute',
  edit: 'edit',
  write: 'edit',
  patch: 'edit',
  apply_patch: 'edit',
  read: 'read',
  grep: 'search',
  glob: 'search',
  list: 'search',
  ls: 'search',
  webfetch: 'fetch',
  websearch: 'fetch',
}
const toolSummary = (input: Wire | undefined): string =>
  String(input?.command ?? input?.filePath ?? input?.path ?? input?.pattern ?? input?.url ?? input?.description ?? '')
const toolText = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((c: Wire) => (typeof c?.text === 'string' ? c.text : ''))
        .join('')
        .slice(-64_000)
    : ''

/** An OpenCode form as Ramu questions, keyed by field. Free-text fields have no options. */
export function formQuestions(form: Wire): AgentQuestion[] {
  return (form.fields ?? [])
    .filter((f: Wire) => !f.hidden && ['string', 'boolean', 'multiselect', 'number', 'integer'].includes(f.type))
    .map((f: Wire) => ({
      id: f.key,
      question: f.description || f.title || form.title || f.key,
      header: (f.title || f.key).slice(0, 40),
      multiSelect: f.type === 'multiselect',
      options:
        f.type === 'boolean'
          ? [
              { label: 'Yes', description: '' },
              { label: 'No', description: '' },
            ]
          : (f.options ?? []).map((o: Wire) => ({
              label: String(o.label ?? o.value),
              description: String(o.description ?? ''),
            })),
    }))
}

/** Ramu's text answers in the types the form's fields take. */
export function formAnswer(
  form: Wire,
  answers: Record<string, string>,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const f of form.fields ?? []) {
    const text = answers[f.key]
    if (text === undefined) continue
    const option = (label: string) =>
      String((f.options ?? []).find((o: Wire) => String(o.label ?? o.value) === label)?.value ?? label)
    out[f.key] =
      f.type === 'boolean'
        ? /^(yes|true)$/i.test(text.trim())
        : f.type === 'number' || f.type === 'integer'
          ? Number(text)
          : f.type === 'multiselect'
            ? text.split(/,\s*/).filter(Boolean).map(option)
            : option(text)
  }
  return out
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

/** Starts `opencode serve` for one chat and waits until it prints its address. */
async function startServer(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ child: ChildProcess; url: string; password?: string }> {
  const port = await freePort()
  const child = spawn(providerBinary('opencode'), ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr!.resume()
  return new Promise((resolve, reject) => {
    let url = '',
      password: string | undefined
    const lines = createInterface({ input: child.stdout! })
    const done = (error?: Error) => {
      clearTimeout(timer)
      clearTimeout(grace)
      lines.removeAllListeners('line')
      if (error) {
        child.kill()
        reject(error)
      } else resolve({ child, url, ...(password ? { password } : {}) })
    }
    const timer = setTimeout(() => done(new Error('OpenCode did not start its server in time')), 30_000)
    let grace: NodeJS.Timeout | undefined
    lines.on('line', (line) => {
      url ||= /listening on (\S+)/i.exec(line)?.[1] ?? ''
      password ??= /password (\S+)/i.exec(line)?.[1]
      // The password, when there is one, follows the address.
      if (url && password) done()
      else if (url && !grace) grace = setTimeout(() => done(), 1000)
    })
    child.once('error', (e) =>
      done(new Error(`Cannot start OpenCode. Install it and configure a model provider first. ${e.message}`)),
    )
    child.once('exit', (code) => done(new Error(`OpenCode exited before it was ready (${code ?? 'signal'})`)))
  })
}

export const createOpenCodeRunner: AgentRunnerFactory = (scope, settings, emit, readOnly) =>
  new OpenCodeSession(scope, settings, emit, readOnly)

export class OpenCodeSession implements AgentRunner {
  readonly canSteer = true
  /** OpenCode adds a steering message to the running turn instead of cancelling it. */
  readonly steerInterrupts = false
  private connection?: McpConnection
  private child?: ChildProcess
  private client?: Client
  private sessionId = ''
  private stopped = false
  private events = new AbortController()
  private turn?: { done: (outcome: Outcome) => void; finished: Promise<void> }
  private text = new Map<string, string>()
  private thinking = new Map<string, string>()
  private tools = 0
  private cost = 0
  private permissions = new Set<string>()
  private forms = new Map<string, Wire>()
  /** `tool.called` carries the input but not the tool's name. */
  private toolNames = new Map<string, string>()

  constructor(
    private scope: AgentScope,
    private settings: AgentSettings,
    private emit: (event: AgentEvent, limit?: boolean | 'low') => void,
    private readOnly = false,
    /** Tests pass a client for an already running server. */
    private connect?: () => Promise<Client>,
  ) {}

  setTools(connection: McpConnection): void {
    this.connection = connection
  }

  async mcpStatus() {
    if (!this.client || this.stopped) return configuredMcpStatus(this.scope, this.connection)
    const { data } = await this.client.mcp.list({ location: { directory: this.scope.cwd } })
    return {
      supported: true,
      live: true,
      source: 'live' as const,
      canReconnect: true,
      servers: data.map((server) => ({
        name: server.name,
        status: server.status.status === 'needs_auth' ? 'needs-auth' : server.status.status,
        ...('error' in server.status ? { error: server.status.error } : {}),
      })),
    }
  }

  async reconnectMcp(name: string): Promise<void> {
    if (!this.client || this.stopped) throw new Error('OpenCode session is not running')
    await this.client.mcp.connect({ server: name, location: { directory: this.scope.cwd } })
  }

  async start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void> {
    const client = await (this.connect?.() ?? this.startServer())
    this.client = client
    await this.subscribe(client)
    const permissions = openCodePermissions(
      this.connection,
      !this.readOnly && !this.connection?.restricted ? this.settings.access : undefined,
    )
    if (resume) {
      try {
        await client.session.get({ sessionID: resume })
      } catch (e) {
        throw new ResumeUnavailable(`OpenCode no longer has this session: ${(e as Error).message}`)
      }
      this.sessionId = resume
      if (permissions.length) await client.session.update({ sessionID: resume, permissions } as never)
    } else {
      const model = openCodeModel(this.settings.model, this.settings.effort)
      const session = await client.session.create({
        location: { directory: this.scope.cwd },
        // OpenCode's built-in plan agent cannot edit, which is what background analysis needs.
        ...(this.readOnly ? { agent: 'plan' } : {}),
        ...(model ? { model } : {}),
        ...(permissions.length ? { permissions } : {}),
      } as never)
      this.sessionId = session.id
    }
    this.emit({
      kind: 'init',
      mcpServers: configuredMcpStatus(this.scope, this.connection, true, {
        provider: 'opencode',
        accountId: this.settings.accountId,
      }).servers,
      cwd: this.scope.cwd,
      model: this.settings.model || 'OpenCode default',
      providerSessionId: this.sessionId,
    })
    await this.send(prompt, attachments)
  }

  private async startServer(): Promise<Client> {
    const env = {
      ...providerEnvironment('opencode', undefined, this.settings.accountId ?? 'default'),
      ...openCodeServerEnv(
        this.connection,
        undefined,
        this.connection
          ? openCodeMcpServers(
              sessionMcpServers(
                this.scope,
                this.connection,
                'opencode',
                this.settings.accountId,
                this.connection?.sharingProjectId,
              ),
            )
          : {},
      ),
    }
    const server = await startServer(this.scope.cwd, env)
    this.child = server.child
    server.child.once('exit', (code) => {
      if (this.stopped) return
      this.emit({ kind: 'error', message: `OpenCode exited (${code ?? 'signal'})` })
      this.turn?.done({ error: `OpenCode exited (${code ?? 'signal'})` })
      this.emit({ kind: 'state', state: 'failed' })
    })
    return OpenCode.make({
      baseUrl: server.url,
      ...(server.password
        ? { headers: { Authorization: `Basic ${Buffer.from(`opencode:${server.password}`).toString('base64')}` } }
        : {}),
    })
  }

  /** Listens before the first prompt so no event of the turn is missed. */
  private subscribe(client: Client): Promise<void> {
    return new Promise((ready, failed) => {
      let connected = false
      void (async () => {
        try {
          for await (const event of client.event.subscribe({ signal: this.events.signal }) as AsyncIterable<Wire>) {
            if (!connected && event.type === 'server.connected') {
              connected = true
              ready()
            }
            this.handle(event)
          }
        } catch (e) {
          if (!connected) failed(e)
          else if (!this.stopped) {
            this.emit({ kind: 'error', message: `Lost OpenCode's event stream: ${(e as Error).message}` })
            this.turn?.done({ error: (e as Error).message })
          }
        }
      })()
      setTimeout(() => {
        if (!connected) {
          connected = true
          ready()
        }
      }, 5000)
    })
  }

  private files(attachments: Attachment[]) {
    return attachments.map((file) => ({ uri: pathToFileURL(file.path).href, name: file.name }))
  }

  async send(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (this.turn) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    if (!this.client || this.stopped) throw new Error('OpenCode session is not running')
    this.text.clear()
    this.thinking.clear()
    this.tools = 0
    this.cost = 0
    this.toolNames.clear()
    let done!: (outcome: Outcome) => void
    const outcome = new Promise<Outcome>((resolve) => (done = resolve))
    this.turn = { done, finished: outcome.then((o) => this.finish(o)) }
    this.emit({ kind: 'state', state: 'running' })
    try {
      await this.client.session.prompt({
        sessionID: this.sessionId,
        text: prompt,
        ...(attachments.length ? { files: this.files(attachments) } : {}),
      } as never)
    } catch (e) {
      done({ error: (e as Error).message })
    }
  }

  async steer(prompt: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.turn || !this.client || this.stopped) throw new Error('There is no running turn to steer')
    await this.client.session.prompt({
      sessionID: this.sessionId,
      text: prompt,
      delivery: 'steer',
      ...(attachments.length ? { files: this.files(attachments) } : {}),
    } as never)
  }

  async interrupt(): Promise<void> {
    const turn = this.turn
    if (!turn || !this.client) return
    await this.client.session.interrupt({ sessionID: this.sessionId }).catch(() => {})
    this.cancelPending()
    await turn.finished
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.cancelPending()
    this.events.abort()
    this.turn?.done({ interrupted: true })
    this.child?.kill()
  }

  replyPermission(id: string, allow: boolean): void {
    if (!this.permissions.delete(id)) throw new Error('That request is no longer pending')
    void this.client?.permission
      .reply({ sessionID: this.sessionId, requestID: id, decision: allow ? 'once' : 'reject' } as never)
      .catch(() => {})
    this.resolved(id, allow ? 'allowed' : 'denied')
  }

  replyQuestion(id: string, answers: Record<string, string>): void {
    const form = this.forms.get(id)
    if (!form) throw new Error('That request is no longer pending')
    this.forms.delete(id)
    void this.client?.session.form
      .reply({ sessionID: this.sessionId, formID: id, answer: formAnswer(form, answers) } as never)
      .catch(() => {})
    this.resolved(id, 'answered')
  }

  private resolved(id: string, outcome: string): void {
    this.emit({ kind: 'request-resolved', requestId: id, outcome })
    if (!this.permissions.size && !this.forms.size && this.turn) this.emit({ kind: 'state', state: 'running' })
  }

  private cancelPending(): void {
    for (const id of this.permissions) this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
    for (const id of this.forms.keys()) {
      void this.client?.session.form.cancel({ sessionID: this.sessionId, formID: id } as never).catch(() => {})
      this.emit({ kind: 'request-resolved', requestId: id, outcome: 'cancelled' })
    }
    this.permissions.clear()
    this.forms.clear()
  }

  private finish(outcome: Outcome): void {
    this.turn = undefined
    this.cancelPending()
    if (this.stopped) return
    const reply = [...this.text.values()].join('\n').trim()
    const error = outcome.error
    const match = error
      ? classifyLimit(error, { provider: 'opencode', channel: 'error' })
      : classifyLimit(reply, { provider: 'opencode', channel: 'reply', toolCalls: this.tools })
    if (match?.confidence === 'high')
      this.emit({ kind: 'usage', readings: [limitedReading(this.settings, error ?? reply)] })
    this.emit(
      {
        kind: 'result',
        isError: !!error || !!match,
        text: error ?? (match ? reply : outcome.interrupted ? 'cancelled' : 'end_turn'),
        costUsd: this.cost || null,
      },
      limitSignal(match),
    )
  }

  /** Text and reasoning arrive as deltas; Ramu's events carry the whole message so far. */
  private grow(map: Map<string, string>, d: Wire, kind: 'text' | 'thinking', whole?: string): void {
    const key = `${d.assistantMessageID}:${d.ordinal ?? 0}`
    const text = whole ?? (map.get(key) ?? '') + (d.delta ?? '')
    map.set(key, text)
    this.emit({ kind, text, messageId: key })
  }

  private handle(event: Wire): void {
    const d: Wire = event.data ?? {}
    const own = d.sessionID === this.sessionId || d.form?.sessionID === this.sessionId
    if (this.stopped || !this.sessionId || !own) return
    switch (event.type) {
      case 'session.text.delta':
        return this.grow(this.text, d, 'text')
      case 'session.text.ended':
        return this.grow(this.text, d, 'text', d.text)
      case 'session.reasoning.delta':
        return this.grow(this.thinking, d, 'thinking')
      case 'session.reasoning.ended':
        return typeof d.text === 'string' ? this.grow(this.thinking, d, 'thinking', d.text) : undefined
      case 'session.tool.input.started':
        this.tools++
        this.toolNames.set(d.id, d.name)
        return this.emit({
          kind: 'tool-use',
          toolUseId: d.id,
          name: d.name,
          summary: d.name,
          toolKind: KINDS[String(d.name).toLowerCase()] ?? 'other',
          status: 'pending',
        })
      case 'session.tool.called':
        return this.emit({
          kind: 'tool-use',
          toolUseId: d.id,
          name: this.toolNames.get(d.id) ?? 'tool',
          summary: toolSummary(d.input),
          input: JSON.stringify(d.input ?? {}, null, 2).slice(0, 256_000),
          status: 'in_progress',
        })
      case 'session.tool.success':
        return this.emit({
          kind: 'tool-result',
          toolUseId: d.id,
          isError: false,
          summary: toolText(d.content),
          status: 'completed',
        })
      case 'session.tool.failed':
        return this.emit({
          kind: 'tool-result',
          toolUseId: d.id,
          isError: true,
          summary: d.error?.message || toolText(d.content) || 'Tool failed',
          status: 'failed',
        })
      case 'session.step.ended':
        this.cost += Number(d.cost) || 0
        return
      case 'session.execution.succeeded':
        return this.turn?.done({})
      case 'session.execution.failed':
        return this.turn?.done({ error: d.error?.message || 'OpenCode failed' })
      case 'session.execution.interrupted':
        return this.turn?.done({ interrupted: true })
      case 'permission.asked': {
        // OpenCode --auto approves asks once; explicit denies never reach this event.
        // Forms/questions remain interactive. Full is a compatibility alias for this provider.
        if (
          this.settings.access === 'full' ||
          this.settings.access === 'auto' ||
          this.readOnly ||
          this.connection?.restricted
        ) {
          void this.client?.permission
            .reply({
              sessionID: this.sessionId,
              requestID: d.id,
              decision: this.readOnly || this.connection?.restricted ? 'reject' : 'once',
            } as never)
            .catch(() => {})
          return
        }
        this.permissions.add(d.id)
        this.emit({
          kind: 'permission-request',
          requestId: d.id,
          toolName: d.action,
          title: d.message || `Allow ${d.action}?`,
          detail: (d.resources ?? []).join('\n'),
          ...(d.resources?.length && !d.resources.includes('*')
            ? {
                approvalKey: permissionKey(d.action, d.resources),
                approvalCommand:
                  ['bash', 'Bash', 'shell', 'command'].includes(d.action) && d.resources.length === 1
                    ? d.resources[0]
                    : undefined,
              }
            : {}),
        })
        return this.emit({ kind: 'state', state: 'needs-input' })
      }
      case 'form.created': {
        const questions = formQuestions(d.form)
        if (!questions.length) return
        this.forms.set(d.form.id, d.form)
        this.emit({ kind: 'question', requestId: d.form.id, questions })
        return this.emit({ kind: 'state', state: 'needs-input' })
      }
    }
  }
}
