import { PagesSetup } from './pagesSetup'
import { TokenExpiryNotices } from './tokenExpiry'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@ramu/shared/types'
import type { InboxNotice } from '@ramu/shared/chat/notices'
import type { DeployBinding, Deployment, UsageReport } from '@ramu/shared/types/deploy'
import { commandLine } from '@ramu/shared/stacks'
import type { AgentService } from '../../agent'
import { HostCredentialStore } from '../../credentials/store'
import type { Db } from '../../db'
import { forgeRemoteOf, repositoryToken } from '../forge/github'
import { commitBranchInfo } from '../git'
import type { Workspace } from '../workspace'
import { HostingAccounts } from './accounts'
import { DeployWatches } from './deployWatch'
import { DomainWatches } from './domainWatch'
import { ResourceService } from './resources'
import { DeployService } from './service'
import { HostingSignIns } from './signIn'
import { UptimeWatches } from './uptime'
import { projectUsage, UsageNotices } from './usage'
import { ProjectWake } from './wake'
import { StoreReleases } from './release'
import { githubActionsTarget } from './envSync'
import { FlySetup } from './flySetup'
import { ServerSetup } from './serverSetup'

const commandOf = (argv: string[] | null | undefined) => (argv ? commandLine(argv) : null)

/** The deploy pieces one host shares between IPC, agent tools and Publish to the web. */
export interface Deploys {
  accounts: HostingAccounts
  service: DeployService
  signIns: HostingSignIns
  domains: DomainWatches
  /** Deployments followed until they finish, then handed to a thread. */
  deployWatch: DeployWatches
  /**
   * A thread pushed `branch` of a repository, or a pull request merged into it (`commit` null): when that is the
   * production branch of the repository the project's platform watches, the deployment it starts is followed.
   */
  pushed(repoId: string, branch: string, commit: string | null, taskId: string | null): Promise<void>
  /**
   * Keeps a database branch per open pull request of a linked repository: one is made (and the preview deployed again
   * with it) when a pull request opens, and removed with its variables when it closes or merges.
   */
  pullRequests(repoId: string, pullRequests: { headBranch: string; state: string; fork?: boolean }[]): Promise<void>
  /** The newest preview deployment of a branch, when the repository is the one its project's platform watches. */
  preview(repoId: string, branch: string): Promise<Deployment | null>
  uptime: UptimeWatches
  /** Every usage report of a project: its hosting platform's, then its resources'. */
  usage(projectId: string): Promise<UsageReport[]>
  usageNotices: UsageNotices
  tokenExpiry: TokenExpiryNotices
  resources: ResourceService
  /** Store releases of a project's Expo app. */
  releases: StoreReleases
  /** The person's own server: connecting it and setting projects up on it. */
  server: ServerSetup
  fly: FlySetup
  pages: PagesSetup
  wake: ProjectWake
}

export function createDeploys(
  workspace: Workspace,
  db: Db,
  agents: AgentService,
  events: {
    /** An incident thread opened: the phones are told and the thread lists refresh. */
    incidentOpened(thread: { taskId: string; sessionId: string }): void
    /** A usage figure neared its limit. */
    notice(notice: InboxNotice): void
  },
  credentials = new HostCredentialStore(),
): Deploys {
  const getState = <T>(key: string, fallback: T) => workspace.getAppState(key, fallback)
  const setState = (key: string, value: unknown) => workspace.setAppState(key, value)
  const accounts = new HostingAccounts(getState, setState, credentials)
  const stack = (projectId: string) => workspace.projectConfiguration(projectId).config.stack
  const resources = new ResourceService(
    {
      getState,
      setState,
      stack: (projectId) => ({
        database: stack(projectId)?.database ?? false,
        migrate: stack(projectId)?.migrate ?? null,
      }),
    },
    accounts,
    credentials,
  )
  /** The project's checkout whose GitHub remote is `repository`. */
  const checkoutOf = async (projectId: string, repository: string) => {
    for (const entry of workspace.listRepositories(projectId)) {
      const remote = await forgeRemoteOf(entry.root)
      if (remote?.origin === 'github.com' && `${remote.owner}/${remote.repo}` === repository) return entry.root
    }
    return null
  }
  const githubRepository = async (projectId: string, repoId: string) => {
    const repository = workspace.getRepository(repoId)
    if (repository.projectId !== projectId) throw new Error('Choose a repository of this project.')
    const remote = await forgeRemoteOf(repository.root)
    if (!remote || remote.origin !== 'github.com')
      throw new Error('Publish this repository to GitHub first: the hosting platforms link to GitHub repositories.')
    const { defaultBranch } = await commitBranchInfo(repository.root)
    return {
      root: repository.root,
      link: {
        owner: remote.owner,
        name: remote.repo,
        githubToken: () => repositoryToken(repository.root),
        productionBranch: defaultBranch ?? 'main',
      },
    }
  }
  const service = new DeployService(
    {
      getState,
      setState,
      async githubToken(projectId, repository) {
        const root = await checkoutOf(projectId, repository)
        if (!root) throw new Error(`This project has no checkout of ${repository} on this host.`)
        return repositoryToken(root)
      },
      stackTarget: (projectId) => stack(projectId)?.deployTarget ?? stack(projectId)?.id ?? null,
      async beforeProduction(projectId, binding) {
        const root = binding.repository ? await checkoutOf(projectId, binding.repository) : null
        if (root) return resources.migrateProduction(projectId, root, binding.productionBranch)
      },
      githubRepository: async (projectId, repoId) => (await githubRepository(projectId, repoId)).link,
    },
    accounts,
  )
  const wake = new ProjectWake(db, workspace, agents)
  const releases = new StoreReleases(
    { roots: (projectId) => workspace.listRepositories(projectId).map((repository) => repository.root) },
    accounts,
  )
  const deployWatch = new DeployWatches(
    { getState, setState, migrate: (projectId) => commandOf(stack(projectId)?.migrate) },
    wake,
    service,
    releases,
  )
  const uptime = new UptimeWatches(
    {
      getState,
      setState,
      projectIds: () => workspace.listProjects().map((project) => project.id),
      healthPath: (projectId) => stack(projectId)?.healthPath ?? null,
      async openThread(projectId, title, brief, requestId) {
        const task = await workspace.createTask({ projectId, title, mode: 'current', requestId })
        // The project's latest thread's model, with no more than Auto access: nobody asked for this thread, and its
        // one consequential action, a rollback, asks the person whatever the access.
        const latest = wake.latestThread(projectId)
        const settings: AgentSettings = latest ? agents.get(latest).settings : DEFAULT_AGENT_SETTINGS
        const session = await agents.startReviewed(task.id, workspace.agentScope(task.id), brief, {
          ...settings,
          access: settings.access === 'full' ? 'auto' : settings.access,
        })
        return { taskId: task.id, sessionId: session.id }
      },
      notify: (thread) => events.incidentOpened(thread),
    },
    wake,
    service,
  )
  /** The repository's project and binding, when the project's platform watches this repository on GitHub. */
  const linkedTo = async (repoId: string): Promise<{ projectId: string; binding: DeployBinding } | null> => {
    const repository = workspace.getRepository(repoId)
    const binding = service.binding(repository.projectId)
    if (!binding?.repository) return null
    const remote = await forgeRemoteOf(repository.root)
    if (remote?.origin !== 'github.com' || `${remote.owner}/${remote.repo}` !== binding.repository) return null
    return { projectId: repository.projectId, binding }
  }
  const usage = (projectId: string) => projectUsage(service, resources, projectId)
  const notices = new UsageNotices(
    {
      getState,
      setState,
      projects: () => workspace.listProjects(),
      latestThread(projectId) {
        const sessionId = wake.latestThread(projectId)
        return sessionId ? { taskId: agents.get(sessionId).taskId, sessionId } : null
      },
      raise: (notice) => events.notice(notice),
    },
    usage,
  )
  // A week before a saved hosting token expires, the projects deploying with it hear where to replace it.
  const tokenExpiry = new TokenExpiryNotices({
    getState,
    setState,
    accounts: () => accounts.list(false, () => false),
    projects: () => workspace.listProjects(),
    platformOf: (projectId) => service.binding(projectId)?.platform ?? null,
    latestThread(projectId) {
      const sessionId = wake.latestThread(projectId)
      return sessionId ? { taskId: agents.get(sessionId).taskId, sessionId } : null
    },
    raise: (notice) => events.notice(notice),
  })
  const reconciling = new Set<string>()
  const reconcileBranches = async (
    repoId: string,
    pullRequests: { headBranch: string; state: string; fork?: boolean }[],
  ) => {
    const projectId = workspace.getRepository(repoId).projectId
    if (!resources.canBranch(projectId) && !resources.branchesOf(projectId).length) return
    const linked = await linkedTo(repoId)
    const environment = linked ? service.branchEnvironment(linked.projectId) : null
    if (!linked || !environment) return
    const open = new Set(
      pullRequests
        .filter((pr) => pr.state === 'open' && !pr.fork && pr.headBranch !== linked.binding.productionBranch)
        .map((pr) => pr.headBranch),
    )
    for (const branch of resources.branchesOf(projectId))
      if (!open.has(branch)) {
        const keys = await resources.closeBranch(projectId, branch)
        if (keys.length) await environment.remove(branch, keys)
      }
    for (const branch of open) {
      const values = await resources.openBranch(projectId, branch)
      if (!values) continue
      await environment.set(branch, values)
      // The branch's first preview was built with the shared preview database; this one uses its own.
      await service.deploy(projectId, branch, false).catch(() => null)
    }
  }
  return {
    accounts,
    service,
    usage,
    usageNotices: notices,
    tokenExpiry,
    signIns: new HostingSignIns(accounts),
    domains: new DomainWatches(workspace, wake, service),
    deployWatch,
    async pushed(repoId, branch, commit, taskId) {
      const linked = await linkedTo(repoId)
      if (!linked) return
      const production = linked.binding.productionBranch === branch
      // Another branch is a preview the platform may build; it is found by the pushed commit.
      if (!production && !commit) return
      const session = taskId
        ? agents.list(taskId).findLast((entry) => !entry.parentId && entry.state !== 'stopped')
        : undefined
      if (production) deployWatch.followPush(linked.projectId, commit, session?.id ?? null)
      else deployWatch.followPreview(linked.projectId, branch, commit!, session?.id ?? null)
    },
    async pullRequests(repoId, pullRequests) {
      // One reconcile per repository at a time, so two list reads never make the same branch twice.
      if (reconciling.has(repoId)) return
      reconciling.add(repoId)
      try {
        await reconcileBranches(repoId, pullRequests)
      } finally {
        reconciling.delete(repoId)
      }
    },
    async preview(repoId, branch) {
      const linked = await linkedTo(repoId)
      return linked ? service.preview(linked.projectId, branch) : null
    },
    uptime,
    resources,
    releases,
    server: new ServerSetup(
      getState,
      setState,
      accounts,
      service,
      { repository: githubRepository, actionsSecrets: githubActionsTarget },
      credentials,
    ),
    fly: new FlySetup(accounts, service, { repository: githubRepository, actionsSecrets: githubActionsTarget }),
    pages: new PagesSetup(accounts, service, { repository: githubRepository }),
    wake,
  }
}
