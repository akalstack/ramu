import { z } from 'zod'
import type { AgentSettings, ProjectAction } from '@ramu/shared/types'
import type { Workspace } from '../../workspace/workspace'
import { agentSettings, id } from '../schemas'
import type { RegisterHandlers } from '../types'

const projectAction = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(4000),
  keys: z.string().max(40).optional(),
})
const planSchema = z.array(
  z.object({ repoId: id, repoName: z.string(), baseRef: z.string(), taskBranch: z.string(), path: z.string() }),
)

/** Projects, folders, repositories and chats (tasks). */
export const registerWorkspaceHandlers: RegisterHandlers = ({
  host,
  workspace,
  agents,
  terminals,
  notices,
  lock,
  hostFolders,
  watchers,
}) => ({
  'projects.list': { args: z.tuple([]), run: () => workspace.listProjects() },
  'projects.create': { args: z.tuple([z.string().max(200)]), run: (name: string) => workspace.createProject(name) },
  'folders.roots': { args: z.tuple([]), run: () => hostFolders.roots() },
  'folders.list': { args: z.tuple([z.string().max(4096)]), run: (path: string) => hostFolders.list(path) },
  'folders.create': {
    args: z.tuple([z.string().max(4096), z.string().max(200)]),
    run: (path: string, name: string) => hostFolders.create(path, name),
  },
  'folders.addProject': {
    args: z.tuple([z.string().max(4096)]),
    run: async (path: string) => workspace.addProjectFromFolder(await hostFolders.inspect(path)),
  },
  'folders.clone': {
    args: z.tuple([z.string().max(4096), z.string().max(200), z.string().max(4096)]),
    run: (parent: string, name: string, url: string) => hostFolders.clone(parent, name, url),
  },
  'projects.inspect': { args: z.tuple([z.string().max(4096)]), run: (dir: string) => workspace.inspectFolder(dir) },
  'projects.addFolder': {
    args: z.tuple([z.string().max(4096), z.array(z.string().max(4096)).max(500).optional()]),
    run: (dir: string, repos?: string[]) => workspace.addProjectFromFolder(dir, repos),
  },
  'repos.list': { args: z.tuple([id]), run: (projectId: string) => workspace.listRepositories(projectId) },
  'repos.add': {
    args: z.tuple([id, z.string().max(4096)]),
    run: (projectId: string, dir: string) => workspace.addRepository(projectId, dir),
  },
  'repos.pick': {
    args: z.tuple([z.enum(['project', 'repository']).optional()]),
    run: async (purpose?: 'project' | 'repository') => {
      return host.native('pickDirectory', purpose ?? 'project')
    },
  },
  'workspaces.list': { args: z.tuple([]), run: () => workspace.listWorkspaces() },
  'tasks.list': { args: z.tuple([]), run: () => workspace.listTasks() },
  'tasks.plan': {
    args: z.tuple([id, z.string().max(200), z.array(id).max(50)]),
    run: (projectId: string, title: string, repoIds: string[]) => workspace.planWorktrees(projectId, title, repoIds),
  },
  'tasks.create': {
    args: z.tuple([
      z.object({
        projectId: id,
        title: z.string().max(200),
        mode: z.enum(['current', 'worktree']),
        workspaceId: id.optional(),
      }),
      planSchema.optional(),
    ]),
    run: (input: Parameters<Workspace['createTask']>[0], plan?: Parameters<Workspace['createTask']>[1]) =>
      workspace.createTask(input, plan),
  },
  'tasks.generateTitle': {
    args: z.tuple([id, agentSettings, z.boolean().optional()]),
    run: async (t: string, settings: AgentSettings, force?: boolean) => {
      if (!force && workspace.titleSource(t) === 'manual') return workspace.getTask(t)
      const title = await agents.draftTitle(t, settings)
      return title ? workspace.setGeneratedTitle(t, title, !!force) : workspace.getTask(t)
    },
  },
  'tasks.rename': {
    args: z.tuple([id, z.string().max(200)]),
    run: (t: string, title: string) => workspace.renameTask(t, title),
  },
  'tasks.pin': {
    args: z.tuple([id, z.boolean()]),
    run: (t: string, pinned: boolean) => workspace.setPinned(t, pinned),
  },
  'tasks.archive': {
    args: z.tuple([id, z.boolean()]),
    run: (t: string, archived: boolean) => workspace.setArchived(t, archived),
  },
  'tasks.delete': {
    args: z.tuple([id, z.boolean()]),
    run: async (taskId: string, removeWorktrees: boolean) => {
      await Promise.all(agents.list(taskId).map((s) => agents.stopAndWait(s.id)))
      terminals.closeTask(taskId)
      const workspaceId = workspace.getTask(taskId).workspaceId
      await workspace.deleteTask(taskId, removeWorktrees)
      notices?.forgetTask(taskId)
      if (removeWorktrees && workspaceId) terminals.closeTask(`worktree:${workspaceId}`)
    },
  },
  'projects.reveal': {
    args: z.tuple([id]),
    run: (projectId: string) => {
      // Only folders Ramu already knows about can be revealed.
      const project = workspace.listProjects().find((p) => p.id === projectId)
      const target = project?.root ?? workspace.listRepositories(projectId)[0]?.root
      if (!target) throw new Error('This project has no folder')
      return host.native('reveal', target)
    },
  },
  'projects.actions': {
    args: z.tuple([id]),
    run: (projectId: string) => workspace.getAppState<ProjectAction[]>(`project-actions:${projectId}`, []),
  },
  'projects.setActions': {
    args: z.tuple([id, z.array(projectAction).max(30)]),
    run: (projectId: string, actions: ProjectAction[]) => {
      if (!workspace.listProjects().some((p) => p.id === projectId)) throw new Error('Unknown project')
      workspace.setAppState(`project-actions:${projectId}`, actions)
      return actions
    },
  },
  'projects.reorder': {
    args: z.tuple([z.array(id).max(500)]),
    run: (ids: string[]) => workspace.reorderProjects(ids),
  },
  'projects.rename': {
    args: z.tuple([id, z.string().max(200)]),
    run: (p: string, name: string) => workspace.renameProject(p, name),
  },
  'projects.remove': { args: z.tuple([id]), run: (p: string) => workspace.removeProject(p) },
  'repos.remove': { args: z.tuple([id]), run: (r: string) => workspace.removeRepository(r) },
  'tasks.setup': {
    args: z.tuple([id]),
    run: async (taskId: string) => {
      const roots = workspace.listBindings(taskId).map((b) => workspace.getRepository(b.repoId).root)
      // Worktree creation touches shared refs, so lock on each repository root.
      return lock.run(`repo:${roots.sort().join('|')}`, () => workspace.setupTask(taskId))
    },
  },
  'tasks.bindings': {
    args: z.tuple([id]),
    run: (taskId: string) => {
      const bindings = workspace.fileBindings(taskId)
      for (const b of bindings) if (b.setupState === 'ready') watchers.ensure(b.cwd)
      return bindings
    },
  },
})
