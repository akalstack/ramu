import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@ramu/shared/types'
import type { InboxNotice } from '@ramu/shared/chat/notices'
import type { UsageReport } from '@ramu/shared/types/deploy'
import type { AgentService } from '../../agent'
import { HostCredentialStore } from '../../credentials/store'
import type { Db } from '../../db'
import { forgeRemoteOf, repositoryToken } from '../forge/github'
import { commitBranchInfo } from '../git'
import type { Workspace } from '../workspace'
import { HostingAccounts } from './accounts'
import { DomainWatches } from './domainWatch'
import { ResourceService } from './resources'
import { DeployService } from './service'
import { HostingSignIns } from './signIn'
import { UptimeWatches } from './uptime'
import { projectUsage, UsageNotices } from './usage'
import { ProjectWake } from './wake'

/** The deploy pieces one host shares between IPC, agent tools and Publish to the web. */
export interface Deploys {
  accounts: HostingAccounts
  service: DeployService
  signIns: HostingSignIns
  domains: DomainWatches
  uptime: UptimeWatches
  /** Every usage report of a project: its hosting platform's, then its resources'. */
  usage(projectId: string): Promise<UsageReport[]>
  usageNotices: UsageNotices
  resources: ResourceService
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
  const service = new DeployService(
    {
      getState,
      setState,
      stackTarget: (projectId) => stack(projectId)?.deployTarget ?? stack(projectId)?.id ?? null,
      async beforeProduction(projectId, binding) {
        for (const repository of workspace.listRepositories(projectId)) {
          const remote = await forgeRemoteOf(repository.root)
          if (remote && `${remote.owner}/${remote.repo}` === binding.repository)
            return resources.migrateProduction(projectId, repository.root, binding.productionBranch)
        }
      },
      async githubRepository(projectId, repoId) {
        const repository = workspace.getRepository(repoId)
        if (repository.projectId !== projectId) throw new Error('Choose a repository of this project.')
        const remote = await forgeRemoteOf(repository.root)
        if (!remote || remote.origin !== 'github.com')
          throw new Error('Publish this repository to GitHub first: the hosting platforms link to GitHub repositories.')
        const { defaultBranch } = await commitBranchInfo(repository.root)
        return {
          owner: remote.owner,
          name: remote.repo,
          githubToken: () => repositoryToken(repository.root),
          productionBranch: defaultBranch ?? 'main',
        }
      },
    },
    accounts,
  )
  const wake = new ProjectWake(db, workspace, agents)
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
  return {
    accounts,
    service,
    usage,
    usageNotices: notices,
    signIns: new HostingSignIns(accounts),
    domains: new DomainWatches(workspace, wake, service),
    uptime,
    resources,
    wake,
  }
}
