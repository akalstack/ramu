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
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[]
}

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
}

/** Read-only inventory of the setup agents get in one project. Nothing here is executed, imported or enabled. */
export interface ProjectSetup {
  projectId: string
  /** The folders inspected: each repository, plus the workspace folder when it is not itself a repository. */
  roots: { label: string; path: string }[]
  mcp: ProjectMcpServer[]
  skills: ProjectSkill[]
  diagnostics: { file: string; message: string }[]
  /** Servers a provider reported in an earlier thread that no readable file declares: only that provider can manage them. */
  providerManaged?: { provider: AgentProvider; name: string }[]
}
