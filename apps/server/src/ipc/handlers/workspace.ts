import { mergeInputSummaries } from '@ramu/shared/chat/inputSummary'
import { generateBranchName } from '../../workspace/branchNaming'
import { projectActionSchema } from '../../workspace/projectConfig'
import { ProjectActions } from '../../workspace/projectActions'
import { projectAgentDefaults } from '../../workspace/projectAgentDefaults'
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
import { routeProject } from '../../workspace/projectRouter'
import { agentSettings, id } from '../schemas'
import type { RegisterHandlers } from '../types'
import type { TaskRemovalReview } from '@ramu/shared/chat/taskRemoval'

const namingIntent = z.object({
  strategy: z.enum(['fixed', 'semantic', 'custom']),
  instructions: z.string().max(2000),
  prompt: z.string().max(6000),
})
const branchChoice = z.object({
  name: z.string().min(1).max(160).refine(validBranchName),
  source: z.enum(['manual', 'generated', 'fallback']),
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
  rules,
}) => {
  const pendingNames = new Map<string, AbortController>()
  const projectConfiguration = (projectId: string) => {
    const result = workspace.projectConfiguration(projectId)
    watchers.projectConfigs.ensure(
      projectId,
      workspace.listProjects().find((project) => project.id === projectId)?.root ?? null,
    )
    return result
  }
  const projectPreferences = (projectId: string) => {
    const prefs = loadPreferences()
    const { config } = projectConfiguration(projectId)
    return {
      ...prefs,
      defaultCheckoutMode: config.workspace?.defaultCheckoutMode ?? prefs.defaultCheckoutMode,
      worktreeBranchPrefix: config.workspace?.branchPrefix ?? prefs.worktreeBranchPrefix,
      worktreeBranchNaming: config.workspace?.branchNaming ?? prefs.worktreeBranchNaming,
      worktreeBranchInstructions: config.workspace?.branchInstructions ?? prefs.worktreeBranchInstructions,
    }
  }
  const projectActions = new ProjectActions(workspace, projectConfiguration)
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
    'projects.route': {
      args: z.tuple([z.string().min(1).max(20_000), agentSettings]),
      run: (prompt: string, settings: AgentSettings) =>
        routeProject(
          prompt,
          settings,
          workspace.listProjects().map((project) => ({
            id: project.id,
            name: project.name,
            aliases: project.aliases,
            description: project.description,
          })),
          (...args) => agents.analyze(...args),
        ),
    },
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
    'workspaces.rename': {
      args: z.tuple([id, z.string().trim().min(1).max(200), z.string().max(200)]),
      run: (workspaceId: string, name: string, before: string) =>
        workspace.renameWorktreeWorkspace(workspaceId, name, before),
    },
    'tasks.list': {
      args: z.tuple([]),
      run: () =>
        workspace.listTasks().map((task) => {
          const sessions = agents.list(task.id).filter((session) => !session.parentId)
          const main = sessions.at(-1)
          const inputSummary = mergeInputSummaries(sessions.map((session) => session.inputSummary))
          const goal = main ? agents.goalOf(main.id) : null
          const executionState = main?.state
          if (!goal || goal.status === 'completed') return { ...task, goalState: null, inputSummary, executionState }
          return {
            ...task,
            inputSummary,
            executionState,
            goalState: {
              status: goal.status,
              ...(goal.pausedBy ? { pausedBy: goal.pausedBy } : {}),
              objective: goal.objective.slice(0, 300),
              ...(goal.claim ? { verifying: true } : {}),
              ...(goal.check && !goal.check.ok ? { verificationFailed: true } : {}),
              ...(goal.reason ? { reason: goal.reason.slice(0, 300) } : {}),
            },
          }
        }),
    },
    'tasks.workspaceOptions': {
      args: z.tuple([id]),
      run: async (projectId: string) => {
        const prefs = projectPreferences(projectId)
        const { source, error } = projectConfiguration(projectId)
        return {
          defaultCheckoutMode: prefs.defaultCheckoutMode,
          branchPrefix: prefs.worktreeBranchPrefix,
          branchNaming: prefs.worktreeBranchNaming,
          branchInstructions: prefs.worktreeBranchInstructions,
          branchNameControls: true,
          configSource: source,
          configError: error,
          worktreeUnavailable: await workspace.worktreeUnavailable(projectId),
        }
      },
    },
    'tasks.agentDefaults': {
      args: z.tuple([id, agentSettings.shape.provider]),
      run: async (projectId: string, provider: AgentSettings['provider']) => {
        const initial = projectConfiguration(projectId)
        let catalog: ReturnType<typeof agents.catalog> | undefined
        const discover = () => (catalog ??= agents.catalog())
        const result = await projectAgentDefaults(initial, provider, discover)
        const current = projectConfiguration(projectId)
        const identity = (value: typeof initial) => JSON.stringify([value.config.agent, value.source, value.error])
        return identity(initial) === identity(current) ? result : projectAgentDefaults(current, provider, discover)
      },
    },
    'tasks.plan': {
      args: z.tuple([
        id,
        z.string().max(200),
        z.array(id).max(50),
        branchChoice.optional(),
        z
          .object({
            branchPrefix: z.string().max(120).refine(validBranchPrefix),
            strategy: z.enum(['fixed', 'semantic', 'custom']),
          })
          .optional(),
      ]),
      run: (
        projectId: string,
        title: string,
        repoIds: string[],
        choice?: BranchChoice,
        naming?: { branchPrefix: string; strategy: BranchNamingIntent['strategy'] },
      ) => {
        const prefs = projectPreferences(projectId)
        return workspace.planWorktrees(
          projectId,
          title,
          repoIds,
          (naming?.strategy ?? prefs.worktreeBranchNaming) === 'fixed'
            ? (naming?.branchPrefix ?? prefs.worktreeBranchPrefix)
            : 'ramu/',
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
        const prefs = projectPreferences(input.projectId)
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
      run: (t: string, archived: boolean) => {
        workspace.setArchived(t, archived)
        // Archived tasks stop watching; opening them again leases their checkouts anew.
        if (archived) watchers.release(t)
      },
    },
    'tasks.delete': {
      args: z.tuple([
        id,
        z.boolean(),
        z
          .object({ backgroundIds: z.array(z.string().uuid()).max(2000), forgetUnknown: z.boolean().optional() })
          .optional(),
      ]),
      run: async (taskId: string, removeWorktrees: boolean, review?: TaskRemovalReview) => {
        const covers = workspace.explorerBindings(taskId).map((binding) => binding.cwd)
        return lock.runMany([`delete-task:${taskId}`, ...covers.map((cwd) => `checkout:${cwd}`)], async () => {
          const task = workspace.getTask(taskId)
          if (
            removeWorktrees &&
            task.workspaceId &&
            workspace.listTasks().some((other) => other.id !== taskId && other.workspaceId === task.workspaceId)
          )
            throw new Error(
              'This isolated workspace is used by other threads. Delete only this thread or remove the other threads first.',
            )
          const contexts = [taskId, ...(removeWorktrees && task.workspaceId ? [`worktree:${task.workspaceId}`] : [])]
          return terminals.withTaskRemoval(contexts, async () => {
            terminals.reviewRemoval(taskId, removeWorktrees, review)
            await Promise.all(agents.list(taskId).map((session) => agents.stopAndWait(session.id)))
            terminals.reviewRemoval(taskId, removeWorktrees, review)
            await terminals.stopForRemoval(taskId)
            terminals.closeTask(taskId, { keepHistory: true })
            if (removeWorktrees && task.workspaceId)
              terminals.closeTask(`worktree:${task.workspaceId}`, { keepHistory: true })
            await workspace.deleteTask(taskId, removeWorktrees)
            terminals.closeTask(taskId)
            notices?.forgetTask(taskId)
            watchers.release(taskId)
            if (removeWorktrees && task.workspaceId) terminals.closeTask(`worktree:${task.workspaceId}`)
          })
        })
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
      run: (projectId: string) => projectActions.list(projectId),
    },
    'projects.actionSettings': {
      args: z.tuple([id]),
      run: (projectId: string) => projectActions.settings(projectId),
    },
    'projects.setActionVisibility': {
      args: z.tuple([id, z.string().min(1).max(64), z.boolean()]),
      run: (projectId: string, actionId: string, hidden: boolean) =>
        projectActions.visibility(projectId, actionId, hidden),
    },
    'projects.resetActionOrder': {
      args: z.tuple([id]),
      run: (projectId: string) => projectActions.resetOrder(projectId),
    },
    'projects.reorderActions': {
      args: z.tuple([id, z.array(z.string().min(1).max(64)).max(60)]),
      run: (projectId: string, actionIds: string[]) => projectActions.reorder(projectId, actionIds),
    },
    'projects.setActions': {
      args: z.tuple([
        id,
        z.array(projectActionSchema.extend({ source: z.enum(['ramu.json', '.ramu/config.json']).optional() })).max(60),
      ]),
      run: (projectId: string, actions: ProjectAction[]) => projectActions.save(projectId, actions),
    },
    'projects.reorder': {
      args: z.tuple([z.array(id).max(500)]),
      run: (ids: string[]) => workspace.reorderProjects(ids),
    },
    'projects.setRouting': {
      args: z.tuple([id, z.array(z.string().max(80)).max(16), z.string().max(1000)]),
      run: (p: string, aliases: string[], description: string) => workspace.setProjectRouting(p, aliases, description),
    },
    'projects.rename': {
      args: z.tuple([id, z.string().max(200)]),
      run: (p: string, name: string) => workspace.renameProject(p, name),
    },
    'projects.remove': {
      args: z.tuple([id]),
      run: (p: string) => {
        workspace.removeProject(p)
        rules?.removeForProject(p)
        watchers.projectConfigs.retain(workspace.listProjects().map((project) => project.id))
      },
    },
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
        for (const b of bindings) if (b.setupState === 'ready') watchers.ensure(b.cwd, taskId)
        return bindings
      },
    },
  }
}
