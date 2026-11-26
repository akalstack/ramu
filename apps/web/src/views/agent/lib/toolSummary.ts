import { mcpToolWords } from '@ramu/shared/chat/mcpToolWords'
import { isViewImageTool, toolImageName } from './toolImage'
import { t as translate } from '../../../i18n'
import { toolKind, KIND_LABEL, KIND_VERB } from '@ramu/shared/chat/agentTools'
import { describeRamuTool, ramuTool } from '@ramu/shared/chat/ramuTools'
import { toolIsRunning, toolVerb } from '@ramu/shared/chat/toolStatus'
import { type ToolResult, type ToolUse } from '../types'

/** MCP tools arrive as mcp__server__tool (Antigravity: mcp_server_tool); show the tool's own words. */
export const toolLabel = (name: string) => mcpToolWords(name, '').verb

/**
 * The headline for a tool the provider gave no title: tool search says what it looked for, and a tool whose summary is just its
 * JSON input shows its name instead. Null leaves the caller's usual "verb + summary" line.
 */
export function toolFallbackTitle(tool: ToolUse, running: boolean): string | null {
  if (tool.title?.trim()) return null
  if (tool.name === 'ToolSearch') {
    const query = /^"?query"?\s*[:=]\s*"?([^"}]*)/.exec(tool.summary)?.[1] ?? tool.summary
    const picked = /^select:(.+)$/.exec(query.trim())?.[1]
    if (picked) {
      const names = picked.split(',').map((name) => toolLabel(name.trim()))
      return `${translate(running ? 'Loading' : 'Loaded')} ${names.join(', ')}`
    }
    return `${translate(running ? 'Searching tools' : 'Searched tools')}${query.trim() ? ` “${query.trim()}”` : ''}`
  }
  if (/^[{[]/.test(tool.summary.trim())) return `${translate(toolVerb('Used', running))} ${toolLabel(tool.name)}`
  return null
}

const VERBS: Record<string, [string, string, string]> = {
  Bash: ['Ran', 'command', 'commands'],
  Edit: ['Edited', 'file', 'files'],
  MultiEdit: ['Edited', 'file', 'files'],
  Write: ['Wrote', 'file', 'files'],
  NotebookEdit: ['Edited', 'notebook', 'notebooks'],
  Read: ['Read', 'file', 'files'],
  Grep: ['Searched', 'pattern', 'patterns'],
  Glob: ['Listed', 'pattern', 'patterns'],
  WebFetch: ['Fetched', 'page', 'pages'],
  WebSearch: ['Searched the web', '', ''],
}

/** A one-line summary of tool calls, like "Ran 2 commands, Read 3 files". */
export function describeTools(tools: ToolUse[], results: Map<string, ToolResult>, active: boolean): string {
  const keyOf = (t: ToolUse) => {
    const call = ramuTool(t)
    return call ? `ramu:${call.name}` : t.name
  }
  const counts = new Map<string, number>()
  for (const t of tools) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1)
  const parts = [...counts].map(([key, n]) => {
    const first = tools.find((t) => keyOf(t) === key)!
    const running = tools.some((t) => keyOf(t) === key && toolIsRunning(results.get(t.toolUseId), active))
    const call = ramuTool(first)
    if (call) {
      const row = describeRamuTool(call, results.get(first.toolUseId)?.summary)
      return `${translate(running ? row.running : row.done)}${n > 1 ? ` ×${n}` : row.subject ? ` ${row.subject}` : ''}`
    }
    if (isViewImageTool(first.name)) {
      const subject = n === 1 ? toolImageName(first) : undefined
      return `${translate(running ? 'Viewing' : 'Viewed')} ${subject ?? translate('{count} images', { count: n })}`
    }
    const name = key
    const v = VERBS[name]
    if (!v) {
      const category = toolKind(first)
      return category === 'other'
        ? translate('Used {name}{count}', { name: toolLabel(name), count: n > 1 ? ` ×${n}` : '' })
        : `${translate(toolVerb(KIND_VERB[category], running))} ${n > 1 ? `${n} · ` : ''}${first.title ?? translate(KIND_LABEL[category])}`
    }
    const verb = translate(toolVerb(v[0], running))
    return v[1] ? translate('{verb} {count} {unit}', { verb, count: n, unit: translate(n === 1 ? v[1] : v[2]) }) : verb
  })
  return parts.join(', ')
}
