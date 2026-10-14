import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type Entry = { name: string; description: string; schema: z.ZodObject; handler: (args: never, extra: never) => CallToolResult | Promise<CallToolResult> }
const CORE = new Set(['ask_user', 'question_status', 'wait_for_answer', 'close_question', 'set_goal', 'get_goal', 'update_goal', 'codex_pre_tool_use', 'tool_result_read'])
const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const ALIASES: Record<string, string> = { memory: 'remember recall preferences knowledge notes', skill: 'procedure workflow learn reusable', schedule: 'calendar recurring reminder cron', review: 'diff feedback discussion', advisor: 'advice consult opinion', session: 'history transcript checkpoint' }
const reply = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

/** A request-local catalog built from the same registrations as direct MCP tools.
 * No arbitrary method dispatch, provider tools, or external MCP catalogs enter it. */
export class ToolRegistry {
  private entries = new Map<string, Entry>()
  readonly server: McpServer
  constructor(private readonly target: McpServer, private readonly deferred: boolean, private readonly transform: (result: CallToolResult) => CallToolResult = (result) => result) {
    this.server = new Proxy(target, { get: (object, key) => key === 'registerTool' ? this.register.bind(this) : Reflect.get(object, key, object) })
  }
  private register(name: string, config: { description?: string; inputSchema?: z.ZodRawShape }, handler: Entry['handler']) {
    const schema = z.object(config.inputSchema ?? {})
    this.entries.set(name, { name, description: config.description ?? '', schema, handler })
    if (!this.deferred || CORE.has(name)) return this.target.registerTool(name, config, async (args, extra) => name === 'tool_result_read' ? await handler(args as never, extra as never) : this.transform(await handler(args as never, extra as never)))
    return { remove: () => this.entries.delete(name) }
  }
  search(query: string, limit = 5) {
    const terms = [...new Set(words(query))]
    return [...this.entries.values()].filter((entry) => entry.name !== 'codex_pre_tool_use').map((entry) => {
      const nameWords = words(entry.name), descriptionWords = words(`${entry.description} ${ALIASES[entry.name.split('_')[0]!] ?? ''}`)
      const score = entry.name === query ? 1000 : terms.reduce((score, term) => score + (nameWords.includes(term) ? 8 : 0) + (descriptionWords.some((word) => word === term || term.length > 3 && word.startsWith(term)) ? 1 : 0), 0)
      return { entry, score }
    }).filter(({ score }) => !terms.length || score > 0).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).slice(0, limit).map(({ entry }) => ({ name: entry.name, description: entry.description, inputSchema: z.toJSONSchema(entry.schema, { unrepresentable: 'any' }) }))
  }
  async invoke(name: string, args: unknown, extra: unknown): Promise<CallToolResult> {
    const entry = this.entries.get(name)
    if (!entry || name === 'codex_pre_tool_use') return { isError: true, content: [{ type: 'text', text: 'Unknown or unavailable Ramu tool. Search again.' }] }
    try { const result = await entry.handler(entry.schema.parse(args) as never, extra as never); return name === 'tool_result_read' ? result : this.transform(result) }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } }
  }
  expose() {
    this.target.registerTool('tool_search', { description: 'Discover only tools exposed by Ramu. Search names and descriptions with keywords; returns matching argument schemas. Use tool_invoke to call a match. Empty query lists the first tools.', inputSchema: { query: z.string().max(500), limit: z.number().int().min(1).max(10).default(5) } }, ({ query, limit }) => reply(this.search(query, limit)))
    this.target.registerTool('tool_invoke', { description: 'Call a Ramu tool found through tool_search. Arguments are validated against its original schema and all original scope checks still apply.', inputSchema: { name: z.string().min(1).max(100), arguments: z.record(z.string(), z.unknown()) } }, ({ name, arguments: args }, extra) => this.invoke(name, args, extra))
  }
}
