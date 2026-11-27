import { z } from 'zod'
import { ADMINISTER_REFUSAL } from '@ramu/shared/devicePermissions'
import { defaultToolChoice, type SharedMcpToolChoice } from '@ramu/shared/mcp'
import type { AgentProvider } from '@ramu/shared/types'
import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpProviderAccount,
  SharedMcpSelection,
} from '@ramu/shared/mcp'
import { sharedMcpAccount, sharedMcpApproval, sharedMcpDefinition, sharedMcpSelection } from '../../mcp/policy'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import {
  MCP_IMPORTS_KEY,
  MCP_SHARING_KEY,
  PROVIDER_MANAGED_KEY,
  type McpImports,
  type ProviderManaged,
} from '../../agent/projectSetup'
import { pendingChoices, takeChoices } from '../../toolSync'
import type { RegisterHandlers } from '../types'

const id = z.string().min(1).max(200)
/** JSON with keys sorted, so two definitions compare by content whatever order their fields were written in. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
/** Safe status is readable by paired clients. All initial administration stays on the execution host. */
export const registerSharedMcpHandlers: RegisterHandlers = (ctx) => {
  /**
   * The first approval of an imported connection is when it replaces the declared copy's sharing: before that no other
   * provider could use it, so turning the old one off would only remove access.
   */
  const importApplied = (connectionId: string) => {
    const workspace = ctx.workspace
    const imports = workspace.getAppState<McpImports>(MCP_IMPORTS_KEY, {})
    const entry = imports[connectionId]
    if (!entry || entry.applied) return
    workspace.setAppState(MCP_IMPORTS_KEY, { ...imports, [connectionId]: { ...entry, applied: true } })
    workspace.setAppState(MCP_SHARING_KEY, {
      ...workspace.getAppState<Record<string, boolean>>(MCP_SHARING_KEY, {}),
      [entry.key]: false,
    })
  }
  /** The name of the plugin that added a connection, if one did. */
  const pluginOf = (connectionId: string) =>
    ctx.plugins?.list().find((plugin) => plugin.mcpConnections.some(({ id }) => id === connectionId))?.name ?? null
  const service = () => {
    if (!ctx.getSharedMcp) throw new Error('Update this host for Shared MCP management')
    return ctx.getSharedMcp()
  }
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true) throw new Error(ADMINISTER_REFUSAL)
    return service()
  }
  return {
    'mcp.status': {
      args: z.tuple([]),
      run: () => {
        const seen = ctx.workspace.getAppState<ProviderManaged>(PROVIDER_MANAGED_KEY, {})
        const providerManaged = AGENT_PROVIDERS.flatMap((provider) =>
          (seen[provider] ?? []).map((name) => ({ provider, name })),
        )
        const owners = new Map(
          (ctx.plugins?.list() ?? []).flatMap((plugin) =>
            plugin.mcpConnections.map(({ id }) => [id, { id: plugin.id, name: plugin.name }] as const),
          ),
        )
        const list = service().list()
        return {
          ...list,
          connections: list.connections.map((entry) => {
            const plugin = owners.get(entry.connection.id)
            return plugin ? { ...entry, plugin } : entry
          }),
          ...(providerManaged.length ? { providerManaged } : {}),
          canAdminister: ctx.host.canAdministerIntegrations?.() === true,
        }
      },
    },
    'mcp.save': {
      args: z.tuple([sharedMcpDefinition, id.optional()]),
      run: (input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string) => {
        const manager = admin()
        const plugin = connectionId ? pluginOf(connectionId) : null
        if (plugin) {
          // A plugin's server can be turned off and on here; what it runs and where comes from the plugin.
          const current = manager.policy.snapshot().connections.find((entry) => entry.id === connectionId)
          const { id: _id, hostId: _host, revision: _revision, ...kept } = current ?? ({} as SharedMcpConnection)
          if (!current || canonical({ ...kept, enabled: input.enabled }) !== canonical(input))
            throw new Error(
              `This server comes from the ${plugin} plugin. Change it by updating or removing the plugin.`,
            )
        }
        return manager.save(input, connectionId)
      },
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
    'mcp.turnOn': {
      args: z.tuple([
        id,
        z
          .array(z.object({ provider: sharedMcpAccount.shape.provider, accountId: id }))
          .min(1)
          .max(40),
        z.record(z.string().max(200), z.enum(['ask', 'allow', 'off'])).optional(),
        z.enum(['default', 'off']).optional(),
      ]),
      run: async (
        connectionId: string,
        logins: { provider: AgentProvider; accountId: string }[],
        choices: Record<string, SharedMcpToolChoice> = {},
        others: 'default' | 'off' = 'default',
      ) => {
        const manager = admin()
        const connection = manager.policy.snapshot().connections.find((entry) => entry.id === connectionId)
        if (!connection) throw new Error('That MCP server is no longer here.')
        // A server copied from another host is turned on with the tools that host has on, the rest off.
        const asThere = Object.keys(choices).length ? null : pendingChoices(ctx.workspace, connectionId)
        if (asThere) {
          choices = asThere
          others = 'off'
        }
        // Each login is known to Shared MCP before it is given access, as one added by hand would be.
        const known = manager.policy.snapshot().accounts
        for (const login of logins)
          if (!known.some((entry) => entry.provider === login.provider && entry.accountId === login.accountId))
            manager.saveAccount({ ...login, shareApprovals: false })
        // One check reads the server's tools; its catalog is the same whichever login asks.
        const inspection = await manager.check(connectionId, {
          ...logins[0]!,
          projectId: connection.scope.hostWide ? null : (connection.scope.projectIds[0] ?? null),
        })
        const tools = inspection.tools.flatMap((tool) => {
          const choice = choices[tool.name] ?? (others === 'off' ? 'off' : defaultToolChoice(tool))
          return choice === 'off'
            ? []
            : [
                {
                  name: tool.name,
                  action: 'write' as const,
                  approval: choice === 'allow' ? ('connection' as const) : ('always' as const),
                },
              ]
        })
        if (!tools.length) throw new Error('Leave at least one tool on, or turn the server off instead.')
        for (const login of logins) {
          if (!connection.providers.includes(login.provider)) continue
          // Turning it on again replaces the login's earlier choices: an older, stricter grant would otherwise win.
          for (const earlier of manager.policy.snapshot().grants)
            if (
              earlier.connectionId === connectionId &&
              earlier.provider === login.provider &&
              earlier.accountIds.includes(login.accountId)
            )
              manager.policy.revoke(earlier.id)
          manager.approve({
            connectionId,
            revision: inspection.revision,
            catalogRevision: inspection.catalogRevision,
            provider: login.provider,
            accountId: login.accountId,
            scope: connection.scope,
            tools,
          })
        }
        importApplied(connectionId)
        takeChoices(ctx.workspace, connectionId)
        return inspection
      },
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
        importApplied(input.connectionId)
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
    /** An account for one identity on this server: Linear once, a work sign-in for Work and a personal one for Personal. */
    'mcp.splitForIdentity': {
      args: z.tuple([id, id]),
      run: (connectionId: string, identityId: string) => {
        if (!ctx.identities?.settings().identities.some((identity) => identity.id === identityId))
          throw new Error('That identity is not on this host.')
        return admin().splitFor(connectionId, identityId)
      },
    },
    'mcp.remove': {
      args: z.tuple([id]),
      run: async (id: string) => {
        const plugin = pluginOf(id)
        if (plugin)
          throw new Error(`This server comes from the ${plugin} plugin. Remove the plugin in Customize → Plugins.`)
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
