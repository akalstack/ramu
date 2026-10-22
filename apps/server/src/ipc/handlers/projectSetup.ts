import { z } from 'zod'
import {
  discoverProjectSetup,
  MCP_SHARING_KEY,
  projectSharingKey,
  SKILL_SHARING_KEY,
  type McpSharing,
  type SkillSharing,
} from '../../agent/projectSetup'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Records a sharing choice, or removes it (`null`) so the next level, or the default, applies again. */
const choose = (all: Record<string, boolean>, key: string, shared: boolean | null) => {
  const { [key]: _old, ...rest } = all
  return shared === null ? rest : { ...rest, [key]: shared }
}

/** What agents get in a project, merged across providers and repositories, and which servers Ramu shares. */
export const registerProjectSetupHandlers: RegisterHandlers = (ctx) => {
  const { workspace, getSharedMcp } = ctx
  const sharing = () => workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {})
  const skillSharing = () => workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {})
  const admin = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true)
      throw new Error('Manage MCP connections and credentials on the host running Ramu')
  }
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
        return discoverProjectSetup(projectId, roots, managed, sharing(), undefined, undefined, skillSharing())
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
