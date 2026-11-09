import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AbilitySource } from '@ramu/shared/providers/abilities'
import { CodexRpc } from './codex'
import { providerEnvironment } from './providerBinaries'

// Codex wire messages are validated by the app-server; only the fields read here cross into Ramu.
type Wire = Record<string, any>

export interface CodexAbilityResult {
  text: string
  /** Generated images: a file Codex saved, or the image itself as base64. */
  images: ({ path: string } | { base64: string })[]
  sources: AbilitySource[]
  tokens?: { input: number; output: number }
  /** The window Codex ran the model with, from its token usage. */
  contextWindow?: number
}

/**
 * Asked of Codex for a long read. Codex runs a model with a smaller window than it allows by default and caps a larger
 * request at the model's own maximum, so asking for more than any model has yields the largest it can serve.
 */
const LARGEST_CONTEXT_REQUEST = 10_000_000

/** MCP servers the login's own config.toml defines, so a run can switch each one off. */
export function configuredCodexServers(configText: string): string[] {
  const names = new Set<string>()
  for (const match of configText.matchAll(/^\s*\[mcp_servers\.(?:"([^"\n]{1,80})"|([A-Za-z0-9_-]{1,80}))\]\s*$/gm)) {
    const name = match[1] ?? match[2]
    if (name && /^[A-Za-z0-9_-]+$/.test(name)) names.add(name)
  }
  return [...names].slice(0, 100)
}

/**
 * Config for a run limited to one built-in tool: no shell, sub-agents, plugins, apps, browser, computer or MCP server,
 * and image generation or web search only when that is the tool asked for (neither for a plain answer).
 */
export function codexAbilityConfig(tool: 'image_gen' | 'web_search' | null, servers: string[]): string[] {
  return [
    'features.shell_tool=false',
    'features.unified_exec=false',
    'features.multi_agent=false',
    'features.plugins=false',
    'features.apps=false',
    'features.browser_use=false',
    'features.computer_use=false',
    'features.goals=false',
    `features.image_generation=${tool === 'image_gen'}`,
    `web_search=${tool === 'web_search' ? '"live"' : '"disabled"'}`,
    ...servers.map((name) => `mcp_servers.${name}.enabled=false`),
  ]
}

function loginServers(accountId: string): string[] {
  const env = providerEnvironment('codex', undefined, accountId)
  try {
    return configuredCodexServers(
      readFileSync(join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'),
    )
  } catch {
    return []
  }
}

const sourcesOf = (item: Wire): AbilitySource[] =>
  (Array.isArray(item.results) ? item.results : [])
    .filter((entry: Wire) => typeof entry?.url === 'string' && /^https?:\/\//.test(entry.url))
    .slice(0, 10)
    .map((entry: Wire) => ({ title: String(entry.title ?? entry.domain ?? entry.url).slice(0, 200), url: entry.url }))

/**
 * One ability step on Codex: an ephemeral thread in an empty folder, read-only, asking nothing, with only the one
 * built-in tool. Rejects with Codex's message when the turn fails; a limit keeps Codex's wording so it can be classified.
 */
export async function codexAbility(options: {
  accountId: string
  model?: string
  tool: 'image_gen' | 'web_search' | null
  /** Run with the largest window the model allows, for reading a long document. */
  longContext?: boolean
  prompt: string
  /** Images the model sees with the prompt, by host path. */
  images?: string[]
  cwd: string
  signal?: AbortSignal
  timeoutMs: number
}): Promise<CodexAbilityResult> {
  const rpc = new CodexRpc(
    undefined,
    [
      ...codexAbilityConfig(options.tool, loginServers(options.accountId)),
      ...(options.longContext ? [`model_context_window=${LARGEST_CONTEXT_REQUEST}`] : []),
    ],
    options.accountId,
  )
  const abort = () => void rpc.close()
  options.signal?.addEventListener('abort', abort, { once: true })
  const result: CodexAbilityResult = { text: '', images: [], sources: [] }
  try {
    let thread = ''
    let finish!: (error?: Error) => void
    const done = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve())
    })
    rpc.onExit = (error) => finish(error)
    rpc.onMessage = (m) => {
      // Nothing may be asked of the person or approved here.
      if (m.id !== undefined && m.method) {
        rpc.write({ id: m.id, error: { code: -32601, message: 'Not available in an ability call' } })
        return
      }
      const p = m.params ?? {}
      if (!thread || p.threadId !== thread) return
      if (m.method === 'thread/tokenUsage/updated') {
        const total = p.tokenUsage?.total
        if (typeof total?.inputTokens === 'number' && typeof total?.outputTokens === 'number')
          result.tokens = { input: total.inputTokens, output: total.outputTokens }
        const window = p.tokenUsage?.modelContextWindow
        if (typeof window === 'number' && window > 0) result.contextWindow = window
      }
      if (m.method === 'item/completed') {
        const item: Wire = p.item ?? {}
        if (item.type === 'agentMessage' && item.text) result.text = String(item.text)
        if (item.type === 'webSearch') result.sources.push(...sourcesOf(item))
        if (item.type === 'imageGeneration') {
          if (item.failure?.type === 'usageLimitExceeded')
            finish(
              Object.assign(new Error('Codex image generation reached its usage limit.'), {
                code: 'usageLimitExceeded',
              }),
            )
          else if (typeof item.savedPath === 'string') result.images.push({ path: item.savedPath })
          else if (typeof item.result === 'string' && item.result) result.images.push({ base64: item.result })
        }
      }
      if (m.method === 'turn/completed')
        finish(
          p.turn?.status === 'failed'
            ? new Error(p.turn?.error?.message || 'The Codex ability call failed')
            : undefined,
        )
    }
    await rpc.initialize()
    const started = await rpc.request('thread/start', {
      cwd: options.cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ...(options.model ? { model: options.model } : {}),
    })
    thread = started.thread.id
    await rpc.request('turn/start', {
      threadId: thread,
      input: [
        { type: 'text', text: options.prompt },
        ...(options.images ?? []).map((path) => ({ type: 'localImage', path })),
      ],
      cwd: options.cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
      effort: 'low',
      ...(options.model ? { model: options.model } : {}),
    })
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      done,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The Codex ability call timed out')), options.timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
    result.sources = result.sources.filter(
      (source, index, all) => all.findIndex((other) => other.url === source.url) === index,
    )
    return result
  } finally {
    options.signal?.removeEventListener('abort', abort)
    await rpc.close()
  }
}
