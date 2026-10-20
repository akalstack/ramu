import { z } from 'zod'
import { discoverProjectSetup, MCP_SHARING_KEY, type McpSharing } from '../../agent/projectSetup'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** What agents get in a project, merged across providers and repositories, and which servers Ramu shares. */
export const registerProjectSetupHandlers: RegisterHandlers = (ctx) => {
  const { workspace, getSharedMcp } = ctx
  const sharing = () => workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {})
  return {
    'projects.setup': {
      args: z.tuple([id]),
      run: (projectId: string) => {
        const project = workspace.listProjects().find((entry) => entry.id === projectId)
        if (!project) throw new Error('Unknown project.')
        const roots = workspace.listRepositories(projectId).map((repo) => ({ label: repo.name, path: repo.root }))
        // A multi-repository workspace folder may hold its own configuration beside the repositories.
        if (project.root && !roots.some((root) => root.path === project.root))
          roots.unshift({ label: project.name, path: project.root })
        const managed = (getSharedMcp?.().list().connections ?? [])
          .filter(({ connection }) => connection.scope.hostWide || connection.scope.projectIds.includes(projectId))
          .map(({ connection }) => ({ id: connection.id, transport: connection.transport }))
        return discoverProjectSetup(projectId, roots, managed, sharing())
      },
    },
    /** Sharing passes a server's own credentials to other providers' sessions, so only the host decides it. */
    'mcp.share': {
      args: z.tuple([z.string().regex(/^[0-9a-f]{16}$/), z.boolean()]),
      run: (key: string, shared: boolean) => {
        if (ctx.host.canAdministerIntegrations?.() !== true)
          throw new Error('Manage MCP connections and credentials on the host running Ramu')
        workspace.setAppState(MCP_SHARING_KEY, { ...sharing(), [key]: shared })
        ctx.host.send('mcp:changed', {})
      },
    },
  }
}
