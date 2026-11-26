import type { AgentToolKind } from '../types'
import { KIND_LABEL, KIND_VERB } from './agentTools'
import { mcpToolWords } from './mcpToolWords'
import { toolVerb } from './toolStatus'

/** One call in a group, as the summary needs it; each app fills this from its own rows. */
export interface SummaryTool {
  /** The tool's name as the provider sent it: `Bash`, `Read`, `mcp__server__tool`. */
  name: string
  running: boolean
  /** One of Ramu's own tools, already put in words. */
  ramu?: { key: string; done: string; running: string; subject?: string }
  /** A tool that shows an image: the file's name when it is known. */
  image?: { name?: string }
  /** What the tool does, for one the table does not name. */
  kind?: AgentToolKind
  /** The provider's own title for the call. */
  title?: string
}

type Say = (text: string, values?: Record<string, string | number>) => string

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

/** MCP tools arrive as mcp__server__tool (Antigravity: mcp_server_tool); show the tool's own words. */
export const toolLabel = (name: string) => mcpToolWords(name, '').verb

/**
 * One line for a group of tool calls, the same on the desktop and the phone: "Ran 2 commands, Read 3 files". Calls of
 * one tool are counted together, in the order each tool first appears, and a kind still running reads in the present.
 */
export function summarizeTools(tools: SummaryTool[], say: Say): string {
  const keyOf = (tool: SummaryTool) => (tool.ramu ? `ramu:${tool.ramu.key}` : tool.name)
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(keyOf(tool), (counts.get(keyOf(tool)) ?? 0) + 1)
  return [...counts]
    .map(([key, n]) => {
      const first = tools.find((tool) => keyOf(tool) === key)!
      const running = tools.some((tool) => keyOf(tool) === key && tool.running)
      if (first.ramu)
        return `${say(running ? first.ramu.running : first.ramu.done)}${
          n > 1 ? ` ×${n}` : first.ramu.subject ? ` ${first.ramu.subject}` : ''
        }`
      if (first.image) {
        const subject = n === 1 ? first.image.name : undefined
        return `${say(running ? 'Viewing' : 'Viewed')} ${subject ?? say('{count} images', { count: n })}`
      }
      const verbs = VERBS[key]
      if (!verbs) {
        const kind = first.kind ?? 'other'
        return kind === 'other'
          ? say('Used {name}{count}', { name: toolLabel(key), count: n > 1 ? ` ×${n}` : '' })
          : `${say(toolVerb(KIND_VERB[kind], running))} ${n > 1 ? `${n} · ` : ''}${first.title ?? say(KIND_LABEL[kind])}`
      }
      const verb = say(toolVerb(verbs[0], running))
      return verbs[1]
        ? say('{verb} {count} {unit}', { verb, count: n, unit: say(n === 1 ? verbs[1] : verbs[2]) })
        : verb
    })
    .join(', ')
}

/** The past-tense verb for a tool the provider names; any other tool takes its kind's verb. */
const TOOL_VERB: Record<string, string> = {
  Bash: 'Ran',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  Write: 'Wrote',
  NotebookEdit: 'Edited',
  Read: 'Read',
  Grep: 'Searched',
  Glob: 'Listed',
  WebFetch: 'Fetched',
  WebSearch: 'Searched',
}

/**
 * The words for a tool the provider gave no title: tool search says what it looked for, and a tool whose summary is
 * just its JSON input shows its name instead. Null leaves the usual "verb + summary".
 */
function fallbackWords(
  tool: { name: string; summary: string },
  running: boolean,
  say: Say,
): { verb: string; subject: string } | null {
  if (tool.name === 'ToolSearch') {
    const query = /^"?query"?\s*[:=]\s*"?([^"}]*)/.exec(tool.summary)?.[1] ?? tool.summary
    const picked = /^select:(.+)$/.exec(query.trim())?.[1]
    if (picked)
      return {
        verb: say(running ? 'Loading' : 'Loaded'),
        subject: picked
          .split(',')
          .map((name) => toolLabel(name.trim()))
          .join(', '),
      }
    return {
      verb: say(running ? 'Searching tools' : 'Searched tools'),
      subject: query.trim() ? `“${query.trim()}”` : '',
    }
  }
  if (/^[{[]/.test(tool.summary.trim())) return { verb: say(toolVerb('Used', running)), subject: toolLabel(tool.name) }
  return null
}

/**
 * One tool call's row, the same on the desktop and the phone, for a call that is neither a file tool nor one of Ramu's
 * own: the provider's title alone when it gave one, otherwise a verb (in the present while it runs) and what it acted
 * on, as "Searched renew(" or "Running pnpm test".
 */
export function toolRowWords(
  tool: { name: string; title?: string; summary: string },
  kind: AgentToolKind,
  running: boolean,
  say: Say,
): { verb: string; subject: string } {
  const title = tool.title?.trim()
  if (title) return { verb: '', subject: title }
  return (
    fallbackWords(tool, running, say) ?? {
      verb: say(toolVerb(TOOL_VERB[tool.name] ?? KIND_VERB[kind], running)),
      subject: tool.summary,
    }
  )
}

/** `toolRowWords` for a call with no title, as one line; null when the usual "verb + summary" applies. */
export function toolFallbackLine(tool: { name: string; summary: string }, running: boolean, say: Say): string | null {
  const words = fallbackWords(tool, running, say)
  return words ? `${words.verb}${words.subject ? ` ${words.subject}` : ''}` : null
}
