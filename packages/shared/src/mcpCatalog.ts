// Hosted MCP servers Customize recommends: each is the service's own remote endpoint, signed in through the service in
// the browser the first time (or open with no sign-in), so adding one takes one click. A service whose plugin in
// Claude's directory adds skills to the same server names it, so the fuller choice is one click too. The links each one
// handles let a running thread suggest it when it mentions or opens one of them.
import type { SharedMcpConnection } from './mcp'
import { CLAUDE_PLUGIN_INDEX } from './plugins'
import type { AgentProvider } from './types'

/** A link a service's tool reads: its host or a subdomain of it, and optionally where on that host. */
export interface LinkRule {
  host: string
  /** The path must match, such as an issue or a dashboard page; any path when absent. */
  path?: RegExp
}

export interface RecommendedMcpServer {
  /** The connection's name, which agents see as the server's name. */
  name: string
  /** The service's own name, as people write it. */
  title: string
  url: string
  /** What it lets an agent do, in a few words. */
  description: string
  /** Whether the service asks the person to sign in before its tools appear. */
  signIn: boolean
  /**
   * The service's own plugin in Claude's directory, which brings this same server with the service's skills; offered
   * first, with the server alone as the lighter choice.
   */
  plugin?: string
  /** Links that mean a thread works with this service; none for a service whose links say nothing about it. */
  links?: readonly LinkRule[]
}

export const RECOMMENDED_MCP_SERVERS: readonly RecommendedMcpServer[] = [
  {
    name: 'context7',
    title: 'Context7',
    url: 'https://mcp.context7.com/mcp',
    description: 'Current docs for libraries and frameworks',
    signIn: false,
  },
  {
    name: 'deepwiki',
    title: 'DeepWiki',
    url: 'https://mcp.deepwiki.com/mcp',
    description: 'Ask questions about any public GitHub repository',
    signIn: false,
    links: [{ host: 'deepwiki.com' }],
  },
  {
    name: 'linear',
    title: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    description: 'Read and update issues and projects',
    signIn: true,
    links: [{ host: 'linear.app' }],
  },
  {
    name: 'sentry',
    title: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    description: 'Investigate errors and performance issues',
    signIn: true,
    plugin: 'sentry',
    links: [{ host: 'sentry.io' }],
  },
  {
    name: 'notion',
    title: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    description: 'Search and edit pages and databases',
    signIn: true,
    plugin: 'notion',
    links: [{ host: 'notion.so' }, { host: 'notion.site' }],
  },
  {
    name: 'atlassian',
    title: 'Atlassian',
    url: 'https://mcp.atlassian.com/v2/mcp',
    description: 'Jira and Confluence',
    signIn: true,
    plugin: 'atlassian',
    links: [{ host: 'atlassian.net' }],
  },
  {
    name: 'figma',
    title: 'Figma',
    url: 'https://mcp.figma.com/mcp',
    description: 'Read designs to build from them',
    signIn: true,
    plugin: 'figma',
    links: [{ host: 'figma.com', path: /^\/(?:file|design|board|proto|make|slides)\// }],
  },
  {
    name: 'stripe',
    title: 'Stripe',
    url: 'https://mcp.stripe.com',
    description: 'Payments, customers and billing',
    signIn: true,
    plugin: 'stripe',
    links: [{ host: 'dashboard.stripe.com' }],
  },
  {
    name: 'supabase',
    title: 'Supabase',
    url: 'https://mcp.supabase.com/mcp',
    description: 'Manage and query Supabase projects',
    signIn: true,
    plugin: 'supabase',
    links: [{ host: 'supabase.com', path: /^\/dashboard(?:\/|$)/ }],
  },
  {
    name: 'vercel',
    title: 'Vercel',
    url: 'https://mcp.vercel.com',
    description: 'Deployments, logs and projects',
    signIn: true,
    plugin: 'vercel',
    links: [
      {
        host: 'vercel.com',
        // A team's project page, not the site's own pages that share the same two-part paths.
        path: /^\/(?!(?:docs|blog|templates|guides|changelog|marketplace|integrations|legal|solutions|kb)(?:\/|$))[^/]+\/[^/]+/,
      },
    ],
  },
]

/**
 * Services whose links point at a plugin rather than a hosted server, because the service's own server needs a key the
 * plugin asks for. `unlessSignedIn` names Ramu's own sign-in that already covers the links, so none is suggested then.
 */
export const LINKED_PLUGINS: readonly {
  name: string
  index: string
  title: string
  links: readonly LinkRule[]
  unlessSignedIn?: 'github'
}[] = [
  {
    name: 'github',
    index: CLAUDE_PLUGIN_INDEX,
    title: 'GitHub',
    links: [{ host: 'github.com', path: /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/ }],
    unlessSignedIn: 'github',
  },
]

/** A link's host and path against one rule: the host itself or a subdomain of it. */
export function linkMatches(url: URL, rule: LinkRule): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host !== rule.host && !host.endsWith(`.${rule.host}`)) return false
  return !rule.path || rule.path.test(url.pathname)
}

/** A server's address without its query or trailing slash, so a plugin's copy of it (`?utm_source=plugin`) matches. */
export const serverAddress = (url: string) => url.split('?')[0]!.replace(/\/$/, '')

/** The Shared MCP connection Customize adds for a recommended server: for one project, or every project when null. */
export function recommendedConnection(
  server: RecommendedMcpServer,
  projectId: string | null,
  providers: AgentProvider[],
): Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'> {
  return {
    name: server.name,
    serviceAccountId: 'public',
    enabled: true,
    scope: projectId ? { hostWide: false, projectIds: [projectId] } : { hostWide: true, projectIds: [] },
    providers,
    transport: { type: 'http', url: server.url, headerSecretRefs: {} },
  }
}
