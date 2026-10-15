import { agentContent } from '@ramu/shared/chat/agentContent'
import { toolDescription, toolInput } from './acpEvents'
// Codex's local app-server protocol, using the user's existing CLI login.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { tmpdir } from 'node:os'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { createInterface } from 'node:readline'
import type {
  UsageReading,
  AgentEvent,
  AgentContent,
  AgentModel,
  AgentSessionInfo,
  AgentTask,
  McpConnection,
} from '@ramu/shared/types'
import type { HelperHistory } from '../agent/helperHistory'

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

  constructor(connection?: McpConnection, extraConfig: string[] = [], accountId?: string) {
    this.process = spawn(
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
        env: {
          ...providerEnvironment('codex', undefined, accountId),
          ...(connection ? { RAMU_MCP_TOKEN: connection.token } : {}),
        },
      },
    )
    this.process.stderr.resume()
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
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`Codex ${method} timed out`))
      }, 30_000)
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
    for (const item of turn.items ?? []) {
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
    const forked = await rpc.request('thread/fork', {
      threadId: options.threadId,
      ephemeral: true,
      excludeTurns: true,
      cwd: options.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ...(options.model ? { model: options.model } : {}),
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
    await Promise.race([
      done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('The side question timed out')), options.timeoutMs ?? 120_000),
      ),
    ])
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
