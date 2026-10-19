import { generateBranchName } from '../../workspace/branchNaming'
import { z } from 'zod'
import {
  DEFAULT_AGENT_SETTINGS,
  type ModelPreferences,
  type AgentSettings,
  type ProjectAction,
} from '@ramu/shared/types'
import type { Workspace } from '../../workspace/workspace'
import {
  validBranchName,
  validBranchPrefix,
  type BranchChoice,
  type BranchNamingIntent,
} from '@ramu/shared/workspaceDefaults'
import { agentSettings, id } from '../schemas'
import type { RegisterHandlers } from '../types'

const namingIntent = z.object({
  strategy: z.enum(['fixed', 'semantic', 'custom']),
  instructions: z.string().max(2000),
  prompt: z.string().max(6000),
})
const branchChoice = z.object({
  name: z.string().min(1).max(160).refine(validBranchName),
  source: z.enum(['manual', 'generated', 'fallback']),
})
const projectAction = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(4000),
  keys: z.string().max(40).optional(),
})
const planSchema = z.array(
  z.object({
    repoId: id,
    repoName: z.string(),
    baseRef: z.string(),
    baseOid: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
    taskBranch: z.string(),
    path: z.string(),
  }),
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
  loadPreferences,
  threadTitles,
}) => {
  const pendingNames = new Map<string, AbortController>()
  const generate = (title: string, intent: BranchNamingIntent, signal?: AbortSignal) => {
    const prefs = loadPreferences()
    const models = workspace.getAppState<ModelPreferences | null>('model-preferences', null)
    const step = models?.sets
      .find((set) => set.id === models.defaultSetId)
      ?.steps.find((step) => step.id === models.defaultStepId)
    const chosen = prefs.intelligence.maintenanceModel ?? step
    return generateBranchName(
      title,
      intent,
      async (prompt, signal) =>
        (
          await agents.analyze(prompt, { ...DEFAULT_AGENT_SETTINGS, ...chosen }, 400, {
            timeoutMs: 15_000,
            signal,
            defer: false,
          })
        ).message,
      15_000,
      signal,
    )
  }
  return {
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
    'tasks.workspaceOptions': {
      args: z.tuple([id]),
      run: async (projectId: string) => ({
        defaultCheckoutMode: loadPreferences().defaultCheckoutMode,
        branchPrefix: loadPreferences().worktreeBranchPrefix,
        branchNaming: loadPreferences().worktreeBranchNaming,
        branchInstructions: loadPreferences().worktreeBranchInstructions,
        worktreeUnavailable: await workspace.worktreeUnavailable(projectId),
      }),
    },
    'tasks.plan': {
      args: z.tuple([id, z.string().max(200), z.array(id).max(50), branchChoice.optional()]),
      run: (projectId: string, title: string, repoIds: string[], choice?: BranchChoice) => {
        const prefs = loadPreferences()
        return workspace.planWorktrees(
          projectId,
          title,
          repoIds,
          prefs.worktreeBranchNaming === 'fixed' ? prefs.worktreeBranchPrefix : 'ramu/',
          choice,
        )
      },
    },
    'tasks.generateBranch': {
      args: z.tuple([id, z.string().max(200), namingIntent, z.string().uuid().optional()]),
      run: async (projectId: string, title: string, intent: BranchNamingIntent, requestId?: string) => {
        if (pendingNames.size >= 16) throw new Error('Branch naming is busy. Try again shortly.')
        if (requestId && pendingNames.has(requestId)) throw new Error('Branch naming request is already running')
        const key = requestId ?? crypto.randomUUID()
        const controller = new AbortController()
        pendingNames.set(key, controller)
        try {
          const reason = await workspace.worktreeUnavailable(projectId)
          if (reason) throw new Error(reason)
          return await generate(title, intent, controller.signal)
        } finally {
          pendingNames.delete(key)
        }
      },
    },
    'tasks.cancelBranch': {
      args: z.tuple([z.string().uuid()]),
      run: (requestId: string) => {
        pendingNames.get(requestId)?.abort()
      },
    },
    'tasks.create': {
      args: z.tuple([
        z.object({
          requestId: z.string().min(1).max(160).optional(),
          branchPrefix: z.string().max(120).refine(validBranchPrefix).optional(),
          branchNaming: namingIntent.optional(),
          branchChoice: branchChoice.optional(),
          projectId: id,
          title: z.string().max(200),
          mode: z.enum(['current', 'worktree']),
          workspaceId: id.optional(),
        }),
        planSchema.optional(),
      ]),
      run: (input: Parameters<Workspace['createTask']>[0], plan?: Parameters<Workspace['createTask']>[1]) => {
        const prefs = loadPreferences()
        const intent = input.branchNaming ?? {
          strategy: prefs.worktreeBranchNaming,
          instructions: prefs.worktreeBranchInstructions,
          prompt: input.title,
        }
        return workspace.createTask(
          {
            ...input,
            branchPrefix: input.mode === 'worktree' ? (input.branchPrefix ?? prefs.worktreeBranchPrefix) : undefined,
          },
          plan,
          intent.strategy === 'fixed'
            ? undefined
            : async () => {
                const reason = await workspace.worktreeUnavailable(input.projectId)
                if (reason) throw new Error(reason)
                return generate(input.title, intent)
              },
        )
      },
    },
    'tasks.generateTitle': {
      args: z.tuple([id, agentSettings, z.boolean().optional()]),
      run: (t: string, settings: AgentSettings, force?: boolean) => {
        if (!threadTitles) throw new Error('Title generation is unavailable')
        return threadTitles.generate(t, settings, force)
      },
    },
    'tasks.rename': {
      args: z.tuple([id, z.string().max(200)]),
      run: (t: string, title: string) =>
        threadTitles ? threadTitles.rename(t, title) : workspace.renameTask(t, title),
    },
    'tasks.pin': {
      args: z.tuple([id, z.boolean()]),
      run: (t: string, pinned: boolean) => workspace.setPinned(t, pinned),
    },
    'tasks.done': {
      args: z.tuple([id, z.boolean()]),
      run: (t: string, done: boolean) => workspace.setDone(t, done),
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
        return lock.runMany(
          roots.map((root) => `repo:${root}`),
          () => workspace.setupTask(taskId),
        )
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
  }
}
