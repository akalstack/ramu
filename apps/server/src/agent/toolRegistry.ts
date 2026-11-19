import { z } from 'zod'
import { toolQuery, toolResultLimit } from '../toolInputs'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type Entry = {
  name: string
  description: string
  schema: z.ZodObject
  handler: (args: never, extra: never) => CallToolResult | Promise<CallToolResult>
}
const CORE = new Set([
  'ask_user',
  'question_status',
  'wait_for_answer',
  'close_question',
  // Always loaded: an agent that never finds it asks for the secret in chat.
  'request_secret',
  'set_goal',
  'get_goal',
  'update_goal',
  // Registered only when the advisor setting is on, whose instructions ask for calls at fixed points in every task.
  'advisor',
  'wait_for_advice',
  // The parent and sub-agent channel: a question it cannot find gets answered in chat, where the other side never sees it.
  'ask_parent',
  'message_parent',
  'answer_subagent',
  // Only registered when the chat has Shared MCP tools; an agent that never finds it makes one call per turn.
  'run_script',
  'codex_pre_tool_use',
])
/** The tools an agent must always see, loaded up front where the provider lets Ramu choose (codex_pre_tool_use is a hook). */
export const ALWAYS_LOADED: ReadonlySet<string> = new Set([...CORE].filter((name) => name !== 'codex_pre_tool_use'))
/** A part of the catalog an endpoint serves: the always-loaded tools, or everything else. */
export type ToolSubset = 'always' | 'deferred'
const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const ALIASES: Record<string, string> = {
  memory: 'remember recall preferences knowledge notes',
  skill: 'procedure workflow learn reusable',
  schedule: 'calendar recurring reminder cron',
  review: 'diff feedback discussion',
  advisor: 'advice consult opinion',
  session: 'history transcript checkpoint',
  request: 'secret token password credential key pin login',
  theme: 'palette colors colours appearance dark light look style',
  settings: 'preferences option configure default toggle turn on off ramu',
  artifact:
    'interactive page visual chart simulation calculator diagram prototype playground explorer walkthrough visualize tracker dashboard',
}
const reply = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

/** A request-local catalog built from the same registrations as direct MCP tools.
 * No arbitrary method dispatch, provider tools, or external MCP catalogs enter it. */
export class ToolRegistry {
  private entries = new Map<string, Entry>()
  readonly server: McpServer
  constructor(
    private readonly target: McpServer,
    private readonly deferred: boolean,
    /** Serve only part of the catalog, for a provider that loads the two parts differently (OpenCode). */
    private readonly subset?: ToolSubset,
  ) {
    this.server = new Proxy(target, {
      get: (object, key) => (key === 'registerTool' ? this.register.bind(this) : Reflect.get(object, key, object)),
    })
  }
  private register(
    name: string,
    config: { description?: string; inputSchema?: z.ZodRawShape },
    handler: Entry['handler'],
  ) {
    // A second tool under one name would silently replace the first in search; fail where it is registered instead.
    if (this.entries.has(name)) throw new Error(`Tool ${name} is already registered`)
    if (this.subset && ALWAYS_LOADED.has(name) !== (this.subset === 'always')) return { remove: () => {} }
    const schema = z.object(config.inputSchema ?? {})
    this.entries.set(name, { name, description: config.description ?? '', schema, handler })
    if (!this.deferred || CORE.has(name))
      return this.target.registerTool(
        name,
        // Listed directly, a provider with its own tool search (Claude) may still defer it; the tools an agent must
        // always see load up front instead. Other providers ignore the marker.
        CORE.has(name) ? { ...config, _meta: { 'anthropic/alwaysLoad': true } } : config,
        async (args, extra) => handler(args as never, extra as never),
      )
    return { remove: () => this.entries.delete(name) }
  }
  search(query: string, limit = 5) {
    const terms = [...new Set(words(query))]
    return [...this.entries.values()]
      .filter((entry) => entry.name !== 'codex_pre_tool_use')
      .map((entry) => {
        const nameWords = words(entry.name),
          descriptionWords = words(`${entry.description} ${ALIASES[entry.name.split('_')[0]!] ?? ''}`)
        const score =
          entry.name === query
            ? 1000
            : terms.reduce(
                (score, term) =>
                  score +
                  (nameWords.includes(term) ? 8 : 0) +
                  (descriptionWords.some((word) => word === term || (term.length > 3 && word.startsWith(term)))
                    ? 1
                    : 0),
                0,
              )
        return { entry, score }
      })
      .filter(({ score }) => !terms.length || score > 0)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .slice(0, limit)
      .map(({ entry }) => ({
        name: entry.name,
        description: entry.description,
        inputSchema: z.toJSONSchema(entry.schema, { unrepresentable: 'any' }),
      }))
  }
  async invoke(name: string, args: unknown, extra: unknown): Promise<CallToolResult> {
    const entry = this.entries.get(name)
    if (!entry || name === 'codex_pre_tool_use')
      return { isError: true, content: [{ type: 'text', text: 'Unknown or unavailable Ramu tool. Search again.' }] }
    try {
      const result = await entry.handler(entry.schema.parse(args) as never, extra as never)
      return result
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
  /** Adds tool_search and tool_invoke; only a deferred catalog needs them, since otherwise every tool is listed. */
  expose() {
    if (!this.deferred) return
    this.target.registerTool(
      'tool_search',
      {
        description:
          'Discover only tools exposed by Ramu. Search names and descriptions with keywords; returns matching argument schemas. Use tool_invoke to call a match. Empty query lists the first tools.',
        inputSchema: { query: toolQuery, limit: toolResultLimit.default(5) },
      },
      ({ query, limit }) => reply(this.search(query, limit)),
    )
    this.target.registerTool(
      'tool_invoke',
      {
        description:
          'Call a Ramu tool found through tool_search. Arguments are validated against its original schema and all original scope checks still apply.',
        inputSchema: { name: z.string().min(1).max(100), arguments: z.record(z.string(), z.unknown()) },
      },
      ({ name, arguments: args }, extra) => this.invoke(name, args, extra),
    )
  }
}
