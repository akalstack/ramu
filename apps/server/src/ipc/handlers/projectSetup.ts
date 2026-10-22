import { z } from 'zod'
import {
  discoverProjectSetup,
  MCP_IMPORTS_KEY,
  MCP_SHARING_KEY,
  SKILL_SHARING_KEY,
  type McpImports,
  type McpSharing,
  type SkillSharing,
} from '../../agent/projectSetup'
import { isAbsolute } from 'node:path'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** What agents get in a project, merged across providers and repositories, and which servers Ramu shares. */
export const registerProjectSetupHandlers: RegisterHandlers = (ctx) => {
  const { workspace, getSharedMcp } = ctx
  const sharing = () => workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {})
  const skillSharing = () => workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {})
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true)
      throw new Error('Manage MCP connections and credentials on the host running Ramu')
  }
  const setupOf = (projectId: string) => {
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
      setup: discoverProjectSetup(projectId, roots, managed, sharing(), undefined, undefined, skillSharing()),
    }
  }
  return {
    'projects.setup': {
      args: z.tuple([id]),
      run: (projectId: string) => setupOf(projectId).setup,
    },
    /**
     * Copies a declared server's non-secret definition into Shared MCP for this project. Values of its environment and
     * headers are never read: the person provides credentials or signs in afterwards, and nothing connects until they
     * choose Connect. A declared copy that Ramu was sharing stops being added to other providers only at the
     * connection's first approval, so one server is not offered twice and no provider loses it before the Shared MCP
     * copy works; the provider that declares it keeps its own copy, and removing the connection restores sharing.
     */
    'mcp.import': {
      args: z.tuple([id, z.string().regex(/^[0-9a-f]{16}$/)]),
      run: (projectId: string, key: string) => {
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
          providers: [...server.providers],
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
      args: z.tuple([z.string().regex(/^[0-9a-f]{16}$/), z.boolean()]),
      run: (key: string, shared: boolean) => {
        admin()
        workspace.setAppState(MCP_SHARING_KEY, { ...sharing(), [key]: shared })
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
        z.boolean(),
      ]),
      run: (name: string, shared: boolean) => {
        admin()
        workspace.setAppState(SKILL_SHARING_KEY, { ...skillSharing(), [name]: shared })
        ctx.host.send('memory:changed', {})
        ctx.host.send('mcp:changed', {})
      },
    },
  }
}
