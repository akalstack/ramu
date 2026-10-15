import { truncate } from './text'

/** One line describing a tool call, from its most telling argument. */
export function summarizeInput(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'query', 'pattern', 'url', 'description', 'prompt']) {
    if (typeof input[key] === 'string') return truncate(input[key] as string)
  }
  return truncate(JSON.stringify(input))
}

const SERVER_TOOL_NAMES: Record<string, string> = { web_search: 'WebSearch', web_fetch: 'WebFetch' }

/** Tools the API runs itself (web search, web fetch) arrive as server_tool_use blocks rather than tool_use. */
export function serverToolUse(
  block: Record<string, unknown>,
): { toolUseId: string; name: string; summary: string } | null {
  if (typeof block.id !== 'string') return null
  const name =
    block.type === 'mcp_tool_use'
      ? `mcp__${String(block.server_name ?? 'server')}__${String(block.name ?? 'tool')}`
      : String(block.name ?? 'Tool')
  return {
    toolUseId: block.id,
    name: SERVER_TOOL_NAMES[name] ?? name,
    summary: summarizeInput((block.input ?? {}) as Record<string, unknown>),
  }
}

/** The matching `*_tool_result` block: a list of result titles, or the error code. */
export function serverToolResult(
  block: Record<string, unknown>,
): { toolUseId: string; isError: boolean; summary: string } | null {
  if (typeof block.tool_use_id !== 'string') return null
  const content = block.content
  if (Array.isArray(content)) {
    const lines = content.map((entry: { title?: string; url?: string; type?: string; text?: string }) =>
      entry.title
        ? `${entry.title}${entry.url ? ` — ${entry.url}` : ''}`
        : (entry.text ?? entry.url ?? `[${entry.type ?? 'result'}]`),
    )
    return { toolUseId: block.tool_use_id, isError: false, summary: truncate(lines.join('\n')) }
  }
  if (content && typeof content === 'object') {
    const entry = content as { type?: string; error_code?: string; url?: string; title?: string }
    const failed = /error$/.test(entry.type ?? '')
    return {
      toolUseId: block.tool_use_id,
      isError: failed,
      summary: failed
        ? String(entry.error_code ?? entry.type)
        : truncate(`${entry.title ?? ''} ${entry.url ?? ''}`.trim() || 'Fetched'),
    }
  }
  return { toolUseId: block.tool_use_id, isError: false, summary: typeof content === 'string' ? truncate(content) : '' }
}

export function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return truncate(content)
  if (Array.isArray(content)) {
    return truncate(
      content.map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n'),
    )
  }
  return ''
}

/** Which sub-agent a message came from: its task id when the SDK says, else the tool call that started it. */
export function subagentOf(msg: { parent_tool_use_id: string | null }): string {
  const tagged = msg as { agent_id?: string; parent_tool_use_id: string | null }
  return tagged.agent_id ?? tagged.parent_tool_use_id!
}
