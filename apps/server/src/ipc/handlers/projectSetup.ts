import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { ADMINISTER_REFUSAL } from '@ramu/shared/devicePermissions'
import type { AgentProvider } from '@ramu/shared/types'
import type { ProjectSetup } from '@ramu/shared/mcp'
import { z } from 'zod'
import {
  discoverProjectSetup,
  MCP_IMPORTS_KEY,
  PROVIDER_MANAGED_KEY,
  type ProviderManaged,
  MCP_SHARING_KEY,
  projectSharingKey,
  SKILL_SHARING_KEY,
  type McpImports,
  type McpSharing,
  type SkillSharing,
} from '../../agent/projectSetup'
import { isAbsolute } from 'node:path'
import { id } from '../schemas'
import type { HandlerContext, RegisterHandlers } from '../types'

const choose = (all: Record<string, boolean>, key: string, shared: boolean | null) => {
  const { [key]: _old, ...rest } = all
  return shared === null ? rest : { ...rest, [key]: shared }
}

function withProviderManaged(setup: ProjectSetup, seen: ProviderManaged): ProjectSetup {
  const declared = new Set(setup.mcp.map((server) => server.name))
  const providerManaged = AGENT_PROVIDERS.flatMap((provider) =>
    (seen[provider] ?? []).filter((name) => !declared.has(name)).map((name) => ({ provider, name })),
  )
  return providerManaged.length ? { ...setup, providerManaged } : setup
}

/**
 * The person's own setup and what applies in every project: no project folders are read, and each choice is the
 * all-projects one, with a count of the projects that chose differently.
 */
export function everywhereSetupOf({ workspace, getSharedMcp }: Pick<HandlerContext, 'workspace' | 'getSharedMcp'>) {
  const managed = (getSharedMcp?.().list().connections ?? [])
    .filter(({ connection }) => connection.scope.hostWide)
    .map(({ connection }) => ({ id: connection.id, transport: connection.transport }))
  return withProviderManaged(
    discoverProjectSetup(
      null,
      [],
      managed,
      workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {}),
      undefined,
      undefined,
      workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {}),
    ),
    workspace.getAppState<ProviderManaged>(PROVIDER_MANAGED_KEY, {}),
  )
}

/** Discovery for one project from its folders and the Shared MCP connections on this host. Nothing is executed. */
export function projectSetupOf(
  { workspace, getSharedMcp }: Pick<HandlerContext, 'workspace' | 'getSharedMcp'>,
  projectId: string,
) {
  const sharing = workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {})
  const skillSharing = workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {})
  const project = workspace.listProjects().find((entry) => entry.id === projectId)
  if (!project) throw new Error('Unknown project.')
  const roots = workspace.listRepositories(projectId).map((repo) => ({ label: repo.name, path: repo.root }))
  // A multi-repository workspace folder may hold its own configuration beside the repositories.
  if (project.root && !roots.some((root) => root.path === project.root))
    roots.unshift({ label: project.name, path: project.root })
  const managed = (getSharedMcp?.().list().connections ?? [])
    .filter(({ connection }) => connection.scope.hostWide || connection.scope.projectIds.includes(projectId))
    .map(({ connection }) => ({ id: connection.id, transport: connection.transport }))
  return {
    project,
    setup: withProviderManaged(
      discoverProjectSetup(projectId, roots, managed, sharing, undefined, undefined, skillSharing),
      workspace.getAppState<ProviderManaged>(PROVIDER_MANAGED_KEY, {}),
    ),
  }
}

/** What agents get in a project, merged across providers and repositories, and which servers Ramu shares. */
export const registerProjectSetupHandlers: RegisterHandlers = (ctx) => {
  const { workspace, getSharedMcp } = ctx
  const sharing = () => workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {})
  const skillSharing = () => workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {})
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true) throw new Error(ADMINISTER_REFUSAL)
  }
  const setupOf = (projectId: string) => projectSetupOf(ctx, projectId)
  return {
    // No project: the person's own setup and the choices that apply in every project.
    'projects.setup': {
      args: z.tuple([id.nullable()]),
      run: (projectId: string | null) => (projectId ? setupOf(projectId).setup : everywhereSetupOf(ctx)),
    },
    /**
     * Copies a declared server's non-secret definition into Shared MCP for this project. Values of its environment and
     * headers are never read: the person provides credentials or signs in afterwards, and nothing connects until they
     * choose Connect. A declared copy that Ramu was sharing stops being added to other providers only at the
     * connection's first approval, so one server is not offered twice and no provider loses it before the Shared MCP
     * copy works; the provider that declares it keeps its own copy, and removing the connection restores sharing.
     */
    'mcp.import': {
      args: z.union([
        z.tuple([id, z.string().regex(/^[0-9a-f]{16}$/)]),
        z.tuple([z.string().regex(/^[0-9a-f]{16}$/), id, z.array(z.enum(AGENT_PROVIDERS)).min(1).max(5)]),
      ]),
      run: (first: string, second: string, providers?: AgentProvider[]) => {
        const projectId = providers ? second : first
        const key = providers ? first : second
        admin()
        if (!getSharedMcp) throw new Error('Update this host for Shared MCP management')
        const { project, setup } = setupOf(projectId)
        const server = setup.mcp.find((entry) => entry.key === key)
        if (!server) throw new Error('This server is no longer declared in the project’s setup.')
        if (server.managedConnectionId) throw new Error('This server is already connected through Ramu.')
        const transport = server.transport
        if (transport.type === 'stdio' && !isAbsolute(transport.command))
          throw new Error(
            'This command is relative to a provider’s folder. Add it as a local command with its full path.',
          )
        const cwd = project.root ?? setup.roots[0]?.path
        if (transport.type === 'stdio' && !cwd) throw new Error('This project has no folder to run the command in.')
        const connection = getSharedMcp().save({
          name: server.name,
          serviceAccountId: 'default',
          enabled: true,
          scope: { projectIds: [projectId], hostWide: false },
          providers: providers ?? [...server.providers],
          transport:
            transport.type === 'http'
              ? { type: 'http', url: transport.url, headerSecretRefs: {} }
              : { type: 'stdio', command: transport.command, args: transport.args, cwd: cwd!, envSecretRefs: {} },
        })
        if (sharing()[key] ?? transport.type === 'http')
          workspace.setAppState(MCP_IMPORTS_KEY, {
            ...workspace.getAppState<McpImports>(MCP_IMPORTS_KEY, {}),
            [connection.id]: { key, wasShared: true, applied: false },
          })
        ctx.host.send('mcp:changed', {})
        return connection
      },
    },
    /** Sharing passes a server's own credentials to other providers' sessions, so only the host decides it. */
    'mcp.share': {
      args: z.tuple([z.string().regex(/^[0-9a-f]{16}$/), z.boolean().nullable(), id.optional()]),
      run: (key: string, shared: boolean | null, projectId?: string) => {
        admin()
        workspace.setAppState(
          MCP_SHARING_KEY,
          choose(sharing(), projectId ? projectSharingKey(projectId, key) : key, shared),
        )
        ctx.host.send('mcp:changed', {})
      },
    },
    /** Copies a skill from a person's own provider folder into the export of every provider and account. */
    'skills.share': {
      args: z.tuple([
        z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(64),
        z.boolean().nullable(),
        id.optional(),
      ]),
      run: (name: string, shared: boolean | null, projectId?: string) => {
        admin()
        workspace.setAppState(
          SKILL_SHARING_KEY,
          choose(skillSharing(), projectId ? projectSharingKey(projectId, name) : name, shared),
        )
        ctx.host.send('memory:changed', {})
        ctx.host.send('mcp:changed', {})
      },
    },
  }
}
