// Hosted MCP servers Customize recommends: each is the service's own remote endpoint, signed in through the service in
// the browser the first time (or open with no sign-in), so adding one takes one click. A service whose plugin in
// Claude's directory adds skills to the same server names it, so the fuller choice is one click too.

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
  },
  {
    name: 'linear',
    title: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    description: 'Read and update issues and projects',
    signIn: true,
  },
  {
    name: 'sentry',
    title: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    description: 'Investigate errors and performance issues',
    signIn: true,
    plugin: 'sentry',
  },
  {
    name: 'notion',
    title: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    description: 'Search and edit pages and databases',
    signIn: true,
    plugin: 'notion',
  },
  {
    name: 'atlassian',
    title: 'Atlassian',
    url: 'https://mcp.atlassian.com/v2/mcp',
    description: 'Jira and Confluence',
    signIn: true,
    plugin: 'atlassian',
  },
  {
    name: 'figma',
    title: 'Figma',
    url: 'https://mcp.figma.com/mcp',
    description: 'Read designs to build from them',
    signIn: true,
    plugin: 'figma',
  },
  {
    name: 'stripe',
    title: 'Stripe',
    url: 'https://mcp.stripe.com',
    description: 'Payments, customers and billing',
    signIn: true,
    plugin: 'stripe',
  },
  {
    name: 'supabase',
    title: 'Supabase',
    url: 'https://mcp.supabase.com/mcp',
    description: 'Manage and query Supabase projects',
    signIn: true,
    plugin: 'supabase',
  },
  {
    name: 'vercel',
    title: 'Vercel',
    url: 'https://mcp.vercel.com',
    description: 'Deployments, logs and projects',
    signIn: true,
    plugin: 'vercel',
  },
]
