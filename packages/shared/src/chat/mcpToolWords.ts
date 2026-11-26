/**
 * How a tool from an MCP server reads in a transcript. Providers pass the raw name (`mcp__server__set_goal`, or
 * Antigravity's `mcp_server_set_goal`) and often a title that only repeats it ("Run mcp_server_set_goal"); the reader
 * needs the tool's own words once.
 */
export function mcpToolWords(name: string, title: string): { verb: string; subject: string } {
  const tool = (/^mcp__.+?__(.+)$/.exec(name) ?? /^mcp_[^_]+_(.+)$/.exec(name))?.[1]
  if (!tool) return { verb: name, subject: title }
  const words = tool.replace(/[_-]+/g, ' ').trim()
  const echo = title.trim().replace(/^Run\s+/i, '') === name
  return { verb: words.charAt(0).toUpperCase() + words.slice(1), subject: echo ? '' : title }
}
