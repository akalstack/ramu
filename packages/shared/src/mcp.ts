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
    | { type: 'http'; url: string; headerSecretRefs: Record<string, string>; allowPrivateNetwork?: boolean }
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
  uncertainCalls: number
}

export type SharedMcpAccess =
  | { status: 'approved'; connectionId: string; revision: string; catalogRevision: string }
  | {
      status: 'disabled' | 'approval-needed' | 'unsupported' | 'not-checked'
      connectionId: string
      reason: string
    }
