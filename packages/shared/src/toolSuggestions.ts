// Tools suggested while a thread runs. The thread's agent suggests most of them with `tool_suggest` when it judges one
// would help; a few cheap rules add the clearest cases without asking a model: a link a known service's tool handles,
// and the one listed plugin made for the project's stack.
import { LINKED_PLUGINS, RECOMMENDED_MCP_SERVERS, linkMatches } from './mcpCatalog'
import type { PluginListing } from './plugins'
import { STACKS, STACK_IDS, type StackId } from './stacks'

/** A recommended Shared MCP server by its catalog name, a plugin listed in an index, or a skill in skills.sh. */
export type SuggestedTool =
  | { kind: 'mcp'; name: string }
  | { kind: 'plugin'; index: string; name: string }
  /** `source` is the skill's GitHub repository (`owner/repo`), `name` the skill in it. */
  | { kind: 'skill'; source: string; name: string }

export type SuggestionReason =
  | { kind: 'link'; host: string }
  | { kind: 'stack'; stack: StackId }
  /** The agent's own one-sentence reason, and where it thinks the tool belongs. */
  | { kind: 'agent'; reason: string; scope: 'project' | 'everywhere' }

/** One suggestion as the host keeps it; whether it is on is read from the host each time the card is drawn. */
export interface ToolSuggestionCard {
  id: string
  sessionId: string
  taskId: string
  projectId: string
  tool: SuggestedTool
  /** The service's own name, such as Figma. */
  title: string
  /** What it lets an agent do. */
  description: string
  /** The service asks the person to sign in before its tools work. */
  signIn: boolean
  reason: SuggestionReason
  /** **Not now**: hidden for this project. */
  dismissed: boolean
  createdAt: number
}

export type ToolSuggestionStatus =
  | { state: 'open' }
  | { state: 'dismissed' }
  | { state: 'on' }
  /** The server is added but no agent has it yet, such as after a sign-in. */
  | { state: 'added'; connectionId: string }
  | { state: 'sign-in'; connectionId: string }
  /** The plugin is installed and still needs its key or account. */
  | { state: 'needs-setup'; pluginId: string }

export interface ToolSuggestionView {
  card: ToolSuggestionCard
  status: ToolSuggestionStatus
  /** Turning tools on is for the computer running the host, as in Customize. */
  canTurnOn: boolean
  /** Viewer devices see the card without its buttons. */
  canAnswer: boolean
}

export const toolKey = (tool: SuggestedTool) =>
  tool.kind === 'skill' ? `skill:${tool.source}/${tool.name}` : `${tool.kind}:${tool.name}`

/** Suggestions one thread's agent may make, so an agent can't fill a thread with cards. */
export const AGENT_SUGGESTIONS_PER_THREAD = 3

const LINK = /\bhttps?:\/\/[^\s<>()[\]{}"'`]+/gi

/** The web links in a piece of text, at most `limit`. */
export function linksIn(text: string, limit = 20): URL[] {
  const out: URL[] = []
  for (const match of text.slice(0, 20_000).matchAll(LINK)) {
    try {
      out.push(new URL(match[0].replace(/[.,;:!?]+$/, '')))
    } catch {
      // Not a link after all, such as a lone `https://`.
    }
    if (out.length >= limit) break
  }
  return out
}

/** The tool a link belongs to: a recommended server, or a plugin when the service's own server needs one. */
export function toolForLink(url: URL): { tool: SuggestedTool; unlessSignedIn?: 'github' } | null {
  const server = RECOMMENDED_MCP_SERVERS.find((entry) => entry.links?.some((rule) => linkMatches(url, rule)))
  if (server) return { tool: { kind: 'mcp', name: server.name } }
  const plugin = LINKED_PLUGINS.find((entry) => entry.links.some((rule) => linkMatches(url, rule)))
  if (!plugin) return null
  return {
    tool: { kind: 'plugin', index: plugin.index, name: plugin.name },
    ...(plugin.unlessSignedIn ? { unlessSignedIn: plugin.unlessSignedIn } : {}),
  }
}

/** The one listing in `candidates`, or null when there are none or several to choose between. */
const only = (candidates: PluginListing[]) => (candidates.length === 1 ? candidates[0]! : null)

/** The only listed plugin made for this stack that isn't installed. */
export function pluginForStack(listings: readonly PluginListing[], stack: StackId): PluginListing | null {
  return only(listings.filter((listing) => !listing.installed && listing.stacks.includes(stack)))
}

export const STACK_MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Gemfile'] as const

/**
 * A project's stack: the one its `ramu.json` names, else what its root files show (the framework a `package.json`
 * depends on, `manage.py`, `go.mod`, a Python or Ruby manifest naming its framework). Null when nothing is clear.
 */
export function detectStack(project: {
  configured?: string | null
  files: readonly string[]
  manifests: Partial<Record<(typeof STACK_MANIFESTS)[number], string>>
}): StackId | null {
  if (project.configured && (STACK_IDS as readonly string[]).includes(project.configured))
    return project.configured as StackId
  const npm = project.manifests['package.json']
  if (npm) {
    let deps: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(npm) as { dependencies?: unknown; devDependencies?: unknown }
      deps = { ...(parsed.devDependencies as object), ...(parsed.dependencies as object) }
    } catch {
      // An unreadable package.json says nothing about the stack.
    }
    if ('next' in deps) return 'nextjs'
    if ('expo' in deps) return 'expo'
    if ('astro' in deps) return 'astro'
    if ('vite' in deps && 'react' in deps) return 'vite-react'
    if ('hono' in deps) return 'node-api'
  }
  if (project.files.includes('manage.py')) return 'django'
  if (project.files.includes('go.mod')) return 'go'
  const python = `${project.manifests['pyproject.toml'] ?? ''}\n${project.manifests['requirements.txt'] ?? ''}`
  if (/^\s*"?fastapi\b/im.test(python) || /["']fastapi\b/i.test(python)) return 'fastapi'
  if (/^\s*"?django\b/im.test(python) || /["']django\b/i.test(python)) return 'django'
  if (/^\s*gem\s+["']rails["']/m.test(project.manifests.Gemfile ?? '')) return 'rails'
  return null
}

/** Why a tool is suggested, as an English copy key and its values for the person's language. */
export function reasonCopy(reason: SuggestionReason): { text: string; values: Record<string, string | number> } {
  if (reason.kind === 'link') return { text: 'This thread links to {0}.', values: { 0: reason.host } }
  if (reason.kind === 'stack') return { text: 'This project uses {0}.', values: { 0: STACKS[reason.stack].name } }
  return { text: 'Suggested by the agent: {0}', values: { 0: reason.reason } }
}
