import { z } from 'zod'
import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpProviderAccount,
  SharedMcpSelection,
} from '@ramu/shared/mcp'
import { sharedMcpAccount, sharedMcpApproval, sharedMcpDefinition, sharedMcpSelection } from '../../mcp/policy'
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
      run: (input: Omit<SharedMcpGrant, 'id' | 'accountIds' | 'shared'> & { accountId: string }) =>
        admin().approve(input),
    },
    'mcp.disconnect': { args: z.tuple([id]), run: (id: string) => admin().disconnect(id) },
    'mcp.remove': { args: z.tuple([id]), run: (id: string) => admin().remove(id) },
    'mcp.checkCredentialStore': {
      args: z.tuple([]),
      run: () => admin().verifyCredentialStore(),
    },
  }
}
