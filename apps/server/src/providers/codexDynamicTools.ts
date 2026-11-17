// Codex hides every MCP tool behind its tool search, so the tools an agent must always see go to Codex as dynamic tools
// instead (experimental app-server API): declared at thread start with deferLoading off, and called back through
// `item/tool/call`, which Ramu answers by calling the same tool on its own MCP endpoint with the chat's token.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpConnection } from '@ramu/shared/types'
import { ALWAYS_LOADED } from '../agent/toolRegistry'

type Wire = Record<string, any>

/** The namespace the dynamic tools sit in; a call from it is a Ramu tool (see `mcpShaped`). */
export const RAMU_NAMESPACE = 'ramu'
/** Questions and helpers can wait a long time for the person, like the MCP server's own tool timeout. */
const CALL_TIMEOUT_MS = 3_600_000
/** Listing happens before the thread starts; a slow endpoint must not hold the chat up. */
const LIST_TIMEOUT_MS = 10_000

/** The always-loaded tools among those the chat's endpoint lists, as one Codex dynamic-tool namespace. */
export function codexDynamicTools(tools: Tool[]): Wire[] {
  const always = tools.filter((tool) => ALWAYS_LOADED.has(tool.name))
  if (!always.length) return []
  return [
    {
      type: 'namespace',
      name: RAMU_NAMESPACE,
      description: 'Ramu: ask the person, keep goals, request secrets, consult the advisor and talk to sub-agents.',
      tools: always.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema,
        deferLoading: false,
      })),
    },
  ]
}

/** An MCP tool result as Codex takes a dynamic tool's answer. */
export function dynamicToolResponse(result: CallToolResult): Wire {
  const contentItems = result.content.flatMap((part): Wire[] =>
    part.type === 'text'
      ? [{ type: 'inputText', text: part.text }]
      : part.type === 'image'
        ? [{ type: 'inputImage', imageUrl: `data:${part.mimeType};base64,${part.data}` }]
        : [],
  )
  return {
    contentItems: contentItems.length ? contentItems : [{ type: 'inputText', text: '' }],
    success: !result.isError,
  }
}

/**
 * A dynamic tool call item in the shape of an MCP tool call, so the transcript, results and Ramu tool rows treat both
 * alike: its namespace is the server, and its output items the result's content.
 */
export function mcpShaped(item: Wire): Wire {
  if (item?.type !== 'dynamicToolCall') return item
  const content = (item.contentItems ?? []).map((part: Wire) =>
    part.type === 'inputText' ? { type: 'text', text: part.text } : { type: 'image', url: part.imageUrl },
  )
  return {
    ...item,
    type: 'mcpToolCall',
    server: item.namespace ?? RAMU_NAMESPACE,
    ...(item.contentItems ? { result: { content } } : {}),
    status: item.success === false ? 'failed' : item.status,
  }
}

/** Lists and calls the chat's Ramu tools over its MCP endpoint. Connects on first use. */
export class RamuToolClient {
  private client: Promise<Client> | undefined
  constructor(private readonly connection: McpConnection) {}

  private connect(): Promise<Client> {
    this.client ??= (async () => {
      const client = new Client({ name: 'ramu-codex', version: '0.1.0' })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(this.connection.url), {
          requestInit: { headers: { Authorization: `Bearer ${this.connection.token}` } },
        }),
        { timeout: LIST_TIMEOUT_MS },
      )
      return client
    })().catch((error) => {
      this.client = undefined
      throw error
    })
    return this.client
  }

  async list(): Promise<Tool[]> {
    return (await (await this.connect()).listTools(undefined, { timeout: LIST_TIMEOUT_MS })).tools
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    return (await (
      await this.connect()
    ).callTool({ name, arguments: args }, undefined, {
      timeout: CALL_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    })) as CallToolResult
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = undefined
    await (await client?.catch(() => undefined))?.close()
  }
}
