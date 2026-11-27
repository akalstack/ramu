import { mergeInputSummaries } from '@ramu/shared/chat/inputSummary'
import { resolveWorkModel, withWorkModel, type WorkModel } from '@ramu/shared/providers/workModel'
import { turnStartedAt } from '@ramu/shared/chat/agentActivity'
import { threadProviders, type ProviderUse } from '@ramu/shared/chat/threadProviders'
import { generateBranchName } from '../../workspace/branchNaming'
import { currentBranch } from '../../workspace/git'
import { projectActionSchema } from '../../workspace/projectConfig'
import { ProjectActions } from '../../workspace/projectActions'
import { projectAgentDefaults } from '../../workspace/projectAgentDefaults'
import { createProjectFolder, runCommand } from '../../workspace/projectCreate'
import { PROJECT_NAME, STACK_IDS, type StackId } from '@ramu/shared/stacks'
import { z } from 'zod'
import {
  doneOrder,
  listedThreads,
  olderDoneThreads,
  type DoneCursor,
  type ThreadListOptions,
} from '@ramu/shared/doneThreads'
import {
  DEFAULT_AGENT_SETTINGS,
  type ModelPreferences,
  type AgentSettings,
  type ProjectAction,
  type AgentSessionInfo,
} from '@ramu/shared/types'
import type { Workspace } from '../../workspace/workspace'
import {
  validBranchName,
  validBranchPrefix,
  type BranchChoice,
  type BranchNamingIntent,
} from '@ramu/shared/workspaceDefaults'
import { routeProject } from '../../workspace/projectRouter'
import type { RoutingCandidate } from '@ramu/shared/workspace/projectRouting'
import type { ContinuationRepo, ContinuationStart, ContinuedEvent } from '@ramu/shared/continuation'
import { agentSettings, id, workModel } from '../schemas'
import type { RegisterHandlers } from '../types'
import { WRITING_STATES } from '../../agent/constants'
import type { ThreadDoneImpact } from '@ramu/shared/chat/threadDone'
import type { TaskRemovalReview } from '@ramu/shared/chat/taskRemoval'

let lastSnapshotAt = 0
/** Never moves backwards, even if the clock does, so clients can order two reads of one task. */
type HostTask = ReturnType<Workspace['listTasks']>[number]
const WORKING_STATES = new Set(['starting', 'running', 'needs-input'])
/** When the main agent's current turn began, for the list's "Working for". */
const withTurnStart = (events: Parameters<typeof turnStartedAt>[0]) => {
  const at = turnStartedAt(events)
  return at === null ? {} : { turnStartedAt: at }
}
const threadListOptions = z
  .object({ recentDone: z.number().int().min(0).max(500), keep: z.array(id).max(2000).optional() })
  .strict()
const doneCursorSchema = z.object({ doneAt: z.number().int().nonnegative(), id }).strict()
const nextSnapshotAt = () => (lastSnapshotAt = Math.max(lastSnapshotAt + 1, Date.now()))

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
/** A project on another of the client's hosts, as the router sees it: names and short descriptions only. */
const routingCandidate = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(200),
  host: z.string().max(200).optional(),
  aliases: z.array(z.string().max(100)).max(8).optional(),
  description: z.string().max(1000).optional(),
})

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
  ruleFiles,
  learning,
  agentThreads,
  pullRequestIndex,
  testDevices,
  computer,
  browser,
  hostBrowser,
  reviews,
  servers,
}) => {
  const continuations = () => {
    if (!agentThreads) throw new Error('Continuing threads is unavailable on this host.')
    return agentThreads
  }
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
  /** `thread`: the model and login the thread being started will run on, which Same as thread names its branch with. */
  const generate = (title: string, intent: BranchNamingIntent, signal?: AbortSignal, thread?: WorkModel) => {
    const prefs = loadPreferences()
    const settings = withWorkModel(
      DEFAULT_AGENT_SETTINGS,
      resolveWorkModel(prefs.intelligence.maintenanceModel, {
        thread,
        models: workspace.getAppState<ModelPreferences | null>('model-preferences', null),
      }),
    )
    return generateBranchName(
      title,
      intent,
      async (prompt, signal) =>
        (
          await agents.analyze(prompt, settings, 400, {
            timeoutMs: 15_000,
            signal,
            defer: false,
          })
        ).message,
      15_000,
      signal,
    )
  }
  /** Stops a thread's agents and commands, then deletes it; `review` approves the commands the person saw. */
  /**
   * A thread marked done gives back what its work was holding, so nothing keeps running or stays open for a thread the
   * person has finished: helpers and background commands (and the servers they run) stop, as do servers and build
   * daemons that outlived their command, and the computer, its browser
   * tabs, a test device and file watching are released. Reopening the thread starts each again as the work needs it.
   */
  const releaseThread = (taskId: string) => {
    for (const session of agents.list(taskId))
      if (session.parentId && WRITING_STATES.includes(session.state))
        void agents.stopAndWait(session.id).catch(() => {})
    for (const command of terminals.listBackground(taskId))
      if (command.state === 'running') {
        try {
          terminals.stopBackground(taskId, command.id, false, 'user')
        } catch {
          // Already stopping or gone; nothing to give back.
        }
      }
    // Servers that outlived the command that started them, and build daemons, would otherwise run until the host stops.
    void servers?.stopLeftBehind(taskId, { all: true }).catch(() => 0)
    computer?.revoke(taskId)
    void testDevices?.releaseThread(taskId)
    watchers.release(taskId)
    // The thread's tabs may be in the host's own browser or in the attached desktop's; close them in both.
    hostBrowser?.closeThread(taskId)
    if (browser?.isReady())
      void browser
        .view(taskId, { kind: 'list' })
        .then((tabs) =>
          Promise.all(
            z
              .array(z.object({ id: z.string() }))
              .parse(tabs)
              .map((tab) => browser.view(taskId, { kind: 'close', tabId: tab.id })),
          ),
        )
        .catch(() => {})
  }
  /** What marking a thread done would stop, so the person can confirm before running work ends. */
  const doneImpact = async (taskId: string): Promise<ThreadDoneImpact> => ({
    // Build daemons are not asked about: they only speed up the next build. A server under a running command counts
    // with that command.
    servers: new Set(
      ((await servers?.list(taskId).catch(() => [])) ?? [])
        .filter((server) => !server.daemon && (server.orphaned || server.owner.kind === 'agent'))
        .map((server) => server.pid),
    ).size,
    commands: terminals.listBackground(taskId).filter((command) => command.state === 'running').length,
    helpers: agents.list(taskId).filter((session) => session.parentId && WRITING_STATES.includes(session.state)).length,
    computer: !!computer?.session(taskId),
    browserTabs:
      (hostBrowser?.threadTabs(taskId) ?? 0) +
      (browser?.isReady()
        ? await browser
            .view(taskId, { kind: 'list' })
            .then((tabs) => z.array(z.object({ id: z.string() })).parse(tabs).length)
            .catch(() => 0)
        : 0),
  })
  const deleteThread = async (taskId: string, removeWorktrees: boolean, review?: TaskRemovalReview) => {
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
        pullRequestIndex?.forget(taskId)
        watchers.release(taskId)
        if (removeWorktrees && task.workspaceId) terminals.closeTask(`worktree:${task.workspaceId}`)
      })
    })
  }
  /** Threads as the lists show them, for the ones `pick` chooses from all of them. */
  const threadSummaries = async (pick: (tasks: HostTask[]) => HostTask[]) => {
    // Branches are read first: everything after the snapshot is read without yielding, so it is one moment.
    const listed = pick(workspace.listTasks())
    const branches = listed.length ? await workspace.threadBranches(listed) : new Map<string, string>()
    const snapshotAt = nextSnapshotAt()
    const tasks = pick(workspace.listTasks())
    const helpers = tasks.length ? agents.helperSummaries() : new Map<string, never>()
    const advice = tasks.length ? agents.unreadAdvice() : new Map<string, number>()
    const sessionsByTask = tasks.length ? agents.listByTask() : new Map<string, AgentSessionInfo[]>()
    const uses = tasks.length ? agents.providerUses() : new Map<string, ProviderUse[]>()
    return tasks.map((task) => {
      const sessions = sessionsByTask.get(task.id) ?? []
      const main = sessions.at(-1)
      const inputSummary = mergeInputSummaries(sessions.map((session) => session.inputSummary))
      const goal = main ? agents.goalOf(main.id) : null
      const executionState = main?.state
      // The thread's cast: each session (the main agent and its helpers) at its creation, plus every provider a
      // session handed off between, with the main agent's provider leading.
      const providers = threadProviders(
        sessions.flatMap((session) => [
          { provider: session.settings.provider, at: session.createdAt },
          ...(uses.get(session.id) ?? []),
        ]),
        main?.settings.provider ?? null,
      )
      const base = {
        ...task,
        providers,
        inputSummary,
        executionState,
        helperSummary: helpers.get(task.id) ?? null,
        ...(advice.get(task.id) ? { unreadAdvice: advice.get(task.id) } : {}),
        ...(main && WORKING_STATES.has(main.state) ? withTurnStart(agents.events(main.id)) : {}),
        pullRequest: pullRequestIndex?.forTask(task) ?? null,
        branch: branches.get(task.id) ?? null,
        snapshotAt,
      }
      if (!goal || goal.status === 'completed') return { ...base, goalState: null }
      return {
        ...base,
        goalState: {
          status: goal.status,
          ...(goal.pausedBy ? { pausedBy: goal.pausedBy } : {}),
          objective: goal.objective.slice(0, 300),
          sessionId: main!.id,
          ...(goal.claim ? { verifying: true } : {}),
          ...(goal.check && !goal.check.ok ? { verificationFailed: true } : {}),
          ...(goal.reason ? { reason: goal.reason.slice(0, 300) } : {}),
        },
      }
    })
  }
  return {
    'projects.list': { args: z.tuple([]), run: () => workspace.listProjects() },
    'projects.route': {
      args: z.tuple([
        z.string().min(1).max(20_000),
        agentSettings,
        z
          .object({
            others: z.array(routingCandidate).max(50).optional(),
            localHost: z.string().max(200).optional(),
          })
          .optional(),
      ]),
      run: (prompt: string, settings: AgentSettings, options?: { others?: RoutingCandidate[]; localHost?: string }) =>
        routeProject(
          prompt,
          settings,
          [
            ...workspace.listProjects().map((project) => ({
              id: project.id,
              name: project.name,
              ...(options?.localHost ? { host: options.localHost } : {}),
              aliases: project.aliases,
              description: project.description,
            })),
            ...(options?.others ?? []),
          ],
          (...args) => agents.analyze(...args),
        ),
    },
    'threads.startInProject': {
      args: z.tuple([
        z.object({ projectId: id, title: z.string().min(1).max(200), prompt: z.string().min(1).max(100_000) }),
        agentSettings,
      ]),
      run: async (input: { projectId: string; title: string; prompt: string }, settings: AgentSettings) => {
        if (!agentThreads) throw new Error('Starting threads from another host is unavailable on this host.')
        await agents.validateSettings(settings)
        return agentThreads.startInProject(input, settings)
      },
    },
    'threads.continuationPackage': {
      args: z.tuple([id]),
      run: (taskId: string) => continuations().continuationPackage(taskId),
    },
    'threads.prepareContinuation': {
      args: z.tuple([
        z.object({ remoteUrl: z.string().min(1).max(2000), repoName: z.string().min(1).max(200) }),
        agentSettings,
      ]),
      run: (repo: Pick<ContinuationRepo, 'remoteUrl' | 'repoName'>, settings: AgentSettings) =>
        continuations().prepareContinuation(repo, settings),
    },
    'threads.continueHere': {
      args: z.tuple([
        z.object({
          key: z.string().uuid(),
          from: z.object({
            hostId: z.string().min(1).max(200),
            hostName: z.string().min(1).max(200),
            taskId: id,
            title: z.string().max(200),
          }),
          projectId: id,
          branch: z.string().max(250),
          prompt: z.string().min(1).max(100_000),
          note: z.string().max(4000).optional(),
          settings: agentSettings,
        }),
      ]),
      run: (start: ContinuationStart) => continuations().continueHere(start),
    },
    'threads.continueInWorktree': {
      args: z.tuple([id, agentSettings.optional()]),
      run: (sessionId: string, settings?: AgentSettings) => continuations().continueInWorktree(sessionId, settings),
    },
    'threads.noteContinued': {
      args: z.tuple([
        id,
        z.object({
          hostId: z.string().min(1).max(200),
          host: z.string().max(200),
          taskId: id,
          title: z.string().max(200),
        }),
      ]),
      run: (taskId: string, event: ContinuedEvent) => agents.recordContinued(taskId, event),
    },
    'projects.create': {
      // A chosen parent is checked by hostFolders.create, as the folder browser's folders are.
      args: z.tuple([
        z
          .object({
            name: z.string().max(100).regex(PROJECT_NAME),
            stack: z.enum(STACK_IDS).optional(),
            parent: z.string().min(1).max(4096).optional(),
          })
          .strict(),
      ]),
      run: async ({ parent, ...input }: { name: string; stack?: StackId; parent?: string }) => {
        const folder = await createProjectFolder(
          { parent: parent ?? workspace.newProjectParent(true), ...input },
          { create: (parent, name) => hostFolders.create(parent, name), run: runCommand },
        )
        // The place the person picked is where their next project goes too, from any device or agent.
        if (parent) workspace.rememberProjectParent(await hostFolders.inspect(parent))
        const { project } = await workspace.addProjectFromFolder(await hostFolders.inspect(folder.path))
        return { project, path: folder.path }
      },
    },
    'projects.defaultParent': { args: z.tuple([]), run: () => workspace.newProjectParent() },
    'folders.places': { args: z.tuple([]), run: () => hostFolders.places() },
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
      args: z.tuple([z.string().max(4096), z.string().max(200), z.string().max(4096), z.string().max(64).optional()]),
      run: (parent: string, name: string, url: string, cloneId?: string) =>
        hostFolders.clone(parent, name, url, cloneId),
    },
    'folders.cloneProgress': {
      args: z.tuple([z.string().max(64)]),
      run: (cloneId: string) => hostFolders.cloneProgress(cloneId),
    },
    'folders.cancelClone': {
      args: z.tuple([z.string().max(64)]),
      run: (cloneId: string) => hostFolders.cancelClone(cloneId),
    },
    'projects.inspect': { args: z.tuple([z.string().max(4096)]), run: (dir: string) => workspace.inspectFolder(dir) },
    'projects.addFolder': {
      args: z.tuple([z.string().max(4096), z.array(z.string().max(4096)).max(500).optional()]),
      run: (dir: string, repos?: string[]) => workspace.addProjectFromFolder(dir, repos),
    },
    'repos.list': { args: z.tuple([id]), run: (projectId: string) => workspace.listRepositories(projectId) },
    'repos.add': {
      args: z.tuple([id, z.string().max(4096)]),
      run: async (projectId: string, dir: string) => {
        const repo = await workspace.addRepository(projectId, dir)
        ruleFiles?.sync()
        return repo
      },
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
      args: z.union([z.tuple([]), z.tuple([threadListOptions])]),
      run: (options?: ThreadListOptions) => threadSummaries((tasks) => listedThreads(tasks, options)),
    },
    'tasks.olderDone': {
      args: z.tuple([doneCursorSchema, z.number().int().min(0).max(50)]),
      run: async (cursor: DoneCursor, limit: number) => {
        let remaining = 0
        const tasks = await threadSummaries((all) => {
          const older = olderDoneThreads(all, cursor, limit)
          remaining = older.remaining
          return older.page
        })
        return { tasks: tasks.sort(doneOrder), remaining }
      },
    },
    'tasks.workspaceOptions': {
      args: z.tuple([id]),
      run: async (projectId: string) => {
        const prefs = projectPreferences(projectId)
        const { error } = projectConfiguration(projectId)
        return {
          defaultCheckoutMode: prefs.defaultCheckoutMode,
          branchPrefix: prefs.worktreeBranchPrefix,
          branchNaming: prefs.worktreeBranchNaming,
          branchInstructions: prefs.worktreeBranchInstructions,
          configError: error,
          worktreeUnavailable: await workspace.worktreeUnavailable(projectId),
          // Threads whose changes are still uncommitted in the project's own checkout, finished or not.
          uncommittedThreads: [
            ...new Set(
              (
                await Promise.all(
                  workspace
                    .listRepositories(projectId)
                    .map((repo) => reviews.uncommittedThreads(repo.root).catch(() => new Set<string>())),
                )
              ).flatMap((owners) => [...owners]),
            ),
          ].slice(0, 100),
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
      args: z.tuple([id, z.string().max(200), namingIntent, z.string().uuid().optional(), workModel.optional()]),
      run: async (
        projectId: string,
        title: string,
        intent: BranchNamingIntent,
        requestId?: string,
        thread?: WorkModel,
      ) => {
        if (pendingNames.size >= 16) throw new Error('Branch naming is busy. Try again shortly.')
        if (requestId && pendingNames.has(requestId)) throw new Error('Branch naming request is already running')
        const key = requestId ?? crypto.randomUUID()
        const controller = new AbortController()
        pendingNames.set(key, controller)
        try {
          const reason = await workspace.worktreeUnavailable(projectId)
          if (reason) throw new Error(reason)
          return await generate(title, intent, controller.signal, thread)
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
          baseBranch: z.string().min(1).max(250).refine(validBranchName).optional(),
          checkout: z
            .object({
              repoId: id,
              branch: z.string().min(1).max(160).refine(validBranchName),
              fetchRef: z
                .string()
                .regex(/^refs\/(pull\/\d+\/head|merge-requests\/\d+\/head)$/)
                .optional(),
            })
            .optional(),
          projectId: id,
          title: z.string().max(200),
          mode: z.enum(['current', 'worktree']),
          workspaceId: id.optional(),
          /** The model and login the thread will run on, for naming its branch. */
          threadModel: workModel.optional(),
        }),
        planSchema.optional(),
      ]),
      run: (
        { threadModel, ...input }: Parameters<Workspace['createTask']>[0],
        plan?: Parameters<Workspace['createTask']>[1],
      ) => {
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
          intent.strategy === 'fixed' || input.checkout
            ? undefined
            : async () => {
                const reason = await workspace.worktreeUnavailable(input.projectId)
                if (reason) throw new Error(reason)
                return generate(input.title, intent, undefined, threadModel)
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
      run: (t: string, done: boolean) => {
        const task = workspace.setDone(t, done)
        if (done) {
          agents.holdThread(t)
          releaseThread(t)
        }
        return task
      },
    },
    'tasks.doneImpact': { args: z.tuple([id]), run: doneImpact },
    'tasks.archive': {
      args: z.tuple([id, z.boolean()]),
      run: (t: string, archived: boolean) => {
        workspace.setArchived(t, archived)
        // Archived tasks stop watching and give their test device back; opening them again leases anew.
        if (archived) {
          watchers.release(t)
          void testDevices?.releaseThread(t)
        }
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
      run: deleteThread,
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
      args: z.tuple([id, z.object({ deleteThreads: z.literal(true) }).optional()]),
      run: async (p: string, options?: { deleteThreads: true }) => {
        const roots = workspace.listRepositories(p).map((repo) => repo.root)
        // The person confirmed the whole project, archived threads included, so every command each thread has is
        // approved. Files stay: worktrees and branches are kept, as removing a project keeps its folders.
        if (options?.deleteThreads)
          for (const task of workspace.listTasks(p))
            await deleteThread(task.id, false, {
              backgroundIds: terminals.listBackground(task.id).map((command) => command.id),
              forgetUnknown: true,
            })
        workspace.removeProject(p)
        rules?.removeForProject(p)
        ruleFiles?.sync(roots)
        learning?.removeProject(p)
        watchers.projectConfigs.retain(workspace.listProjects().map((project) => project.id))
      },
    },
    'repos.remove': {
      args: z.tuple([id]),
      run: (r: string) => {
        const { root } = workspace.getRepository(r)
        workspace.removeRepository(r)
        ruleFiles?.sync([root])
      },
    },
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
      run: async (taskId: string) => {
        const bindings = workspace.fileBindings(taskId)
        for (const b of bindings) if (b.setupState === 'ready') watchers.ensure(b.cwd, taskId)
        // A current-checkout thread has no branch of its own; the one checked out is where its work lands.
        return Promise.all(
          bindings.map(async (b) =>
            b.mode === 'current' && !b.folderOnly ? { ...b, checkedOut: await currentBranch(b.cwd) } : b,
          ),
        )
      },
    },
  }
}
