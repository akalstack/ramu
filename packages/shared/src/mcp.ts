import type { AgentProvider } from './types/agent'

/** IDs refer to one execution host. These records never contain credential values. */
export interface SharedMcpConnection {
  id: string
  hostId: string
  name: string
  serviceAccountId: string
  revision: string
  enabled: boolean
  scope: { projectIds: string[]; hostWide: boolean }
  providers: AgentProvider[]
  /**
   * One identity's own account on another connection's server: the same server and tools, signed in separately. A
   * project of that identity uses it in place of the base connection, so its agent still sees one server.
   */
  split?: { base: string; identityId: string }
  transport:
    | {
        type: 'http'
        url: string
        headerSecretRefs: Record<string, string>
        allowPrivateNetwork?: boolean
        oauthClientId?: string
      }
    | { type: 'stdio'; command: string; args: string[]; cwd: string; envSecretRefs: Record<string, string> }
}

export interface SharedMcpProviderAccount {
  provider: AgentProvider
  /** The native/default login also needs a stable ID; absence is never a wildcard. */
  accountId: string
  shareApprovals: boolean
}

export interface SharedMcpGrant {
  id: string
  connectionId: string
  revision: string
  catalogRevision: string
  provider: AgentProvider
  accountIds: string[]
  shared: boolean
  /** A grant can narrow, but never broaden, the connection's scope. */
  scope: { projectIds: string[]; hostWide: boolean }
  tools: { name: string; action: 'read' | 'write'; approval: 'always' | 'connection' }[]
}

export interface SharedMcpPolicyState {
  connections: SharedMcpConnection[]
  accounts: SharedMcpProviderAccount[]
  grants: SharedMcpGrant[]
}

export interface SharedMcpSelection {
  provider: AgentProvider
  accountId: string
  projectId: string | null
}

export interface SharedMcpInspection {
  connectionId: string
  revision: string
  catalogRevision: string
  checkedAt: number
  tools: {
    name: string
    description?: string
    inputSchema: Record<string, unknown>
    /** What the server says about the tool; read-only is a default the person can change, never a grant by itself. */
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
  }[]
}

/** How one tool of a server is used once it is turned on. */
export type SharedMcpToolChoice = 'ask' | 'allow' | 'off'

/**
 * The default for a tool when a server is turned on: one the server marks read-only runs without a card, every other
 * asks on each call. The person sees and can change each before or after.
 */
export const defaultToolChoice = (tool: SharedMcpInspection['tools'][number]): SharedMcpToolChoice =>
  tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true ? 'allow' : 'ask'

/**
 * Whether one provider login can use the shared connections that apply to its provider. A grant, a provider sign-in or a
 * quota reading alone never makes it ready: only a verified catalog with a matching approval does.
 */
export interface SharedMcpAccountReadiness {
  provider: AgentProvider
  accountId: string
  status: 'ready' | 'approval-needed' | 'sign-in-required' | 'unsupported' | 'not-checked'
  /** When the newest connection check behind this status ran; null when nothing was checked. */
  checkedAt: number | null
  reason: string
  /** The connections behind the status, so a row can say which one needs attention. */
  connections: { connectionId: string; name: string; status: SharedMcpAccountReadiness['status'] }[]
}

export interface SharedMcpManagement {
  hostId: string
  credentialStore: 'not-checked' | 'available' | 'unavailable'
  accounts: SharedMcpProviderAccount[]
  connections: {
    connection: SharedMcpConnection
    status:
      | 'disabled'
      | 'not-connected'
      | 'connecting'
      | 'connected'
      | 'failed'
      | 'unsupported'
      | 'sign-in-required'
      | 'insufficient-permission'
    checkedAt: number | null
    reason?: string
    toolCount?: number
    /** The logins it is turned on for, and each tool's choice: asked on every call, or run without asking. */
    granted?: {
      provider: AgentProvider
      accountId: string
      tools: { name: string; approval: 'always' | 'connection' }[]
    }[]
    /** The plugin that added it: removing, editing or turning it off belongs to the plugin. */
    plugin?: { id: string; name: string }
  }[]
  /** One entry per provider login set up for shared approvals. */
  readiness: SharedMcpAccountReadiness[]
  uncertainCalls: number
  /** Servers a provider reported in an earlier thread that Ramu does not manage; only that provider has them. */
  providerManaged?: { provider: AgentProvider; name: string }[]
}

export type SharedMcpAccess =
  | { status: 'approved'; connectionId: string; revision: string; catalogRevision: string }
  | {
      status: 'disabled' | 'approval-needed' | 'unsupported' | 'not-checked'
      connectionId: string
      reason: string
    }

/** One place a server or skill is declared: a provider's user config, a repository file, or Claude's local scope. */
export interface ProjectSetupSource {
  /** `user` applies to every project on this host; `project` comes from this project's folders. */
  scope: 'user' | 'project'
  /** Repository or folder name for project sources; the provider name for user sources. */
  label: string
  /** Display path, with the home folder shown as `~`. */
  file: string
  /** The provider whose own configuration this is; absent for files every provider receives through Ramu. */
  provider?: AgentProvider
  /** False when the file declares it but turns it off. */
  enabled: boolean
}

/** `project`: chosen for this project only. `host`: chosen for every project. `default`: nobody has chosen. */
export type ProjectShareScope = 'project' | 'host' | 'default'

/** A declared server. Values of env vars and headers are never read into this record, only their names. */
export interface ProjectMcpServer {
  /** Stable per transport, so the same server declared for several providers or repositories is one entry. */
  key: string
  name: string
  transport: { type: 'http'; url: string } | { type: 'stdio'; command: string; args: string[] }
  envKeys: string[]
  headerKeys: string[]
  /** Providers that receive it in this project, natively or because Ramu shares it. */
  providers: AgentProvider[]
  /** Providers whose own configuration (or Ramu's repository forwarding) already gives it to them. */
  nativeProviders: AgentProvider[]
  /** Ramu gives it to every provider and account. Remote servers default to on, local commands to off. */
  shared: boolean
  /** Where the choice that applies in this project was made: for this project, for every project, or not at all. */
  shareScope: ProjectShareScope
  /** Why it cannot be shared, when it cannot. */
  shareBlocked?: string
  scope: 'user' | 'project'
  sources: ProjectSetupSource[]
  /** Another server uses this name with a different transport. */
  nameConflict: boolean
  /** Shared MCP connection on this host with the same transport, when one exists. */
  managedConnectionId?: string
  /** In the all-projects view: how many projects chose differently for themselves. */
  exceptions?: number
}

export interface ProjectSkill {
  name: string
  description: string
  /** Providers that load it in this project, from their own folders or because Ramu shares it. */
  providers: AgentProvider[]
  /** Providers that load it from their own skill folders. */
  nativeProviders: AgentProvider[]
  /** Ramu copies it to every provider and account that does not have it. Off unless turned on. */
  shared: boolean
  shareScope: ProjectShareScope
  /** Why it cannot be shared, when it cannot. */
  shareBlocked?: string
  scope: 'user' | 'project'
  sources: ProjectSetupSource[]
  /** The same name has different content in different places. */
  nameConflict: boolean
  /** In the all-projects view: how many projects chose differently for themselves. */
  exceptions?: number
}

/**
 * Read-only inventory of the setup agents get in one project, or with no project the person's own setup and the choices
 * that apply in every project. Nothing here is executed, imported or enabled.
 */
export interface ProjectSetup {
  projectId: string | null
  /** The folders inspected: each repository, plus the workspace folder when it is not itself a repository. */
  roots: { label: string; path: string }[]
  mcp: ProjectMcpServer[]
  skills: ProjectSkill[]
  diagnostics: { file: string; message: string }[]
  /** Servers a provider reported in an earlier thread that no readable file declares: only that provider can manage them. */
  providerManaged?: { provider: AgentProvider; name: string }[]
}

type Translate = (text: string, values?: Record<string, string | number>) => string

/** Where a skill or server comes from, two places at most: user files by path, project files under their folder. */
export function setupFromText(sources: readonly ProjectSetupSource[], t: Translate): string {
  const places = [
    ...new Set(sources.map((source) => (source.scope === 'user' ? source.file : `${source.label}/${source.file}`))),
  ]
  const shown = places.slice(0, 2).join(', ')
  return places.length > 2 ? t('{places} and {count} more', { places: shown, count: places.length - 2 }) : shown
}

/** One line on who has a skill or server now: shared, only some providers, or off everywhere. */
export function setupReachText(
  item: Pick<ProjectSkill, 'shared' | 'shareBlocked' | 'nativeProviders' | 'shareScope'>,
  t: Translate,
  providerName: (provider: AgentProvider) => string,
): string {
  if (item.shared)
    return item.shareScope === 'project'
      ? t('Shared with every provider and account in this project')
      : t('Shared with every provider and account')
  if (item.shareBlocked) return t(item.shareBlocked)
  if (!item.nativeProviders.length) return t('Turned off in every provider')
  return t('Only in {providers}', { providers: item.nativeProviders.map(providerName).join(', ') })
}

/** How a thread's MCP connection reads in its status list, on the desktop and the phone alike. */
export function mcpStatusLabel(status: string): string {
  return (
    {
      configured: 'Configured',
      unknown: 'Connection status unknown',
      unsupported: 'Not supported by this runtime',
      cancelled: 'Cancelled',
      connected: 'Connected',
      pending: 'Connecting',
      connecting: 'Connecting',
      failed: 'Failed',
      'needs-auth': 'Needs authentication',
      disabled: 'Disabled',
    }[status] ?? status
  )
}

/**
 * Whether a server address itself names a host on a private network: localhost, a private or link-local IP, or a
 * name only a local network resolves (.local, .internal, .lan, .home.arpa). Typing one is the person's own choice to
 * reach it, so it needs no separate opt-in; a public name that resolves privately still does.
 */
export function namesPrivateHost(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (/\.(local|internal|lan|home\.arpa)$/.test(host)) return true
  const ip = host.split('.').map(Number)
  if (ip.length === 4 && ip.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = ip as [number, number, number, number]
    return (
      a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
    )
  }
  return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)
}

/** A name for a server from its address, so most people never type one: `https://mcp.deepwiki.com/mcp` → `deepwiki`. */
export function serverNameFromUrl(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
  const parts = host.split('.').filter((part) => part && !['www', 'mcp', 'api'].includes(part))
  // The registrable name: the label before the top-level domain, or the whole host when it has no dots.
  return (parts.length > 1 ? parts[parts.length - 2] : parts[0]) ?? ''
}
