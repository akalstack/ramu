import { z } from 'zod'
import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpProviderAccount,
  SharedMcpSelection,
} from '@ramu/shared/mcp'
import { sharedMcpAccount, sharedMcpApproval, sharedMcpDefinition, sharedMcpSelection } from '../../mcp/policy'
import { MCP_IMPORTS_KEY, MCP_SHARING_KEY, type McpImports } from '../../agent/projectSetup'
import type { RegisterHandlers } from '../types'

const id = z.string().min(1).max(200)
/** Safe status is readable by paired clients. All initial administration stays on the execution host. */
export const registerSharedMcpHandlers: RegisterHandlers = (ctx) => {
  const service = () => {
    if (!ctx.getSharedMcp) throw new Error('Update this host for Shared MCP management')
    return ctx.getSharedMcp()
  }
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true)
      throw new Error('Manage MCP connections and credentials on the host running Ramu')
    return service()
  }
  return {
    'mcp.status': {
      args: z.tuple([]),
      run: () => ({ ...service().list(), canAdminister: ctx.host.canAdministerIntegrations?.() === true }),
    },
    'mcp.save': {
      args: z.tuple([sharedMcpDefinition, id.optional()]),
      run: (input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string) =>
        admin().save(input, connectionId),
    },
    'mcp.account': {
      args: z.tuple([sharedMcpAccount]),
      run: (account: SharedMcpProviderAccount) => admin().saveAccount(account),
    },
    'mcp.removeAccount': {
      args: z.tuple([sharedMcpAccount.shape.provider, id]),
      run: (provider: SharedMcpProviderAccount['provider'], accountId: string) =>
        admin().removeAccount(provider, accountId),
    },
    'mcp.check': {
      args: z.tuple([id, sharedMcpSelection]),
      run: (connectionId: string, selection: SharedMcpSelection) => admin().check(connectionId, selection),
    },
    'mcp.recheckAccount': {
      args: z.tuple([sharedMcpAccount.shape.provider, id, id.nullable()]),
      run: (provider: SharedMcpProviderAccount['provider'], accountId: string, projectId: string | null) =>
        admin().recheckAccount(provider, accountId, projectId),
    },
    'mcp.approve': {
      args: z.tuple([sharedMcpApproval]),
      run: (input: Omit<SharedMcpGrant, 'id' | 'accountIds' | 'shared'> & { accountId: string }) => {
        const grant = admin().approve(input)
        // The first approval of an imported connection is when it replaces the declared copy's sharing: before that
        // no other provider could use it, so turning the old one off would only remove access.
        const workspace = ctx.workspace
        const imports = workspace.getAppState<McpImports>(MCP_IMPORTS_KEY, {})
        const entry = imports[input.connectionId]
        if (entry && !entry.applied) {
          workspace.setAppState(MCP_IMPORTS_KEY, { ...imports, [input.connectionId]: { ...entry, applied: true } })
          workspace.setAppState(MCP_SHARING_KEY, {
            ...workspace.getAppState<Record<string, boolean>>(MCP_SHARING_KEY, {}),
            [entry.key]: false,
          })
        }
        return grant
      },
    },
    'mcp.signIn': { args: z.tuple([id]), run: (connectionId: string) => admin().signIn(connectionId) },
    'mcp.completeSignIn': {
      args: z.tuple([id, z.string().min(1).max(4000)]),
      run: (connectionId: string, address: string) => admin().completeSignIn(connectionId, address),
    },
    'mcp.cancelSignIn': { args: z.tuple([id]), run: (connectionId: string) => admin().cancelSignIn(connectionId) },
    'mcp.setCredential': {
      args: z.tuple([id, z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/), z.string().min(1).max(65536)]),
      run: (connectionId: string, name: string, value: string) => admin().setCredential(connectionId, name, value),
    },
    'mcp.removeCredential': {
      args: z.tuple([id, z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/)]),
      run: (connectionId: string, name: string) => admin().removeCredential(connectionId, name),
    },
    /** Write-only: the value is stored in the host's credential store and never returned or listed. */
    'mcp.setSecret': {
      args: z.tuple([id, z.enum(['header', 'env']), z.string().min(1).max(128), z.string().min(1).max(65536)]),
      run: (connectionId: string, kind: 'header' | 'env', name: string, value: string) =>
        admin().setSecret(connectionId, kind, name, value),
    },
    'mcp.removeSecret': {
      args: z.tuple([id, z.enum(['header', 'env']), z.string().min(1).max(128)]),
      run: (connectionId: string, kind: 'header' | 'env', name: string) =>
        admin().removeSecret(connectionId, kind, name),
    },
    'mcp.disconnect': { args: z.tuple([id]), run: (id: string) => admin().disconnect(id) },
    'mcp.remove': {
      args: z.tuple([id]),
      run: async (id: string) => {
        await admin().remove(id)
        // An imported server stops replacing the declared copy: give back the sharing it displaced.
        const workspace = ctx.workspace
        const imports = workspace.getAppState<McpImports>(MCP_IMPORTS_KEY, {})
        const entry = imports[id]
        if (!entry) return
        const { [id]: _removed, ...rest } = imports
        workspace.setAppState(MCP_IMPORTS_KEY, rest)
        if (entry.applied && entry.wasShared)
          workspace.setAppState(MCP_SHARING_KEY, {
            ...workspace.getAppState<Record<string, boolean>>(MCP_SHARING_KEY, {}),
            [entry.key]: true,
          })
      },
    },
    'mcp.checkCredentialStore': {
      args: z.tuple([]),
      run: () => admin().verifyCredentialStore(),
    },
  }
}
