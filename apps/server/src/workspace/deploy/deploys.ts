import type { AgentService } from '../../agent'
import { HostCredentialStore } from '../../credentials/store'
import type { Db } from '../../db'
import { forgeRemoteOf, repositoryToken } from '../forge/github'
import { commitBranchInfo } from '../git'
import type { Workspace } from '../workspace'
import { HostingAccounts } from './accounts'
import { DomainWatches } from './domainWatch'
import { DeployService } from './service'
import { HostingSignIns } from './signIn'

/** The deploy pieces one host shares between IPC, agent tools and Publish to the web. */
export interface Deploys {
  accounts: HostingAccounts
  service: DeployService
  signIns: HostingSignIns
  domains: DomainWatches
}

export function createDeploys(
  workspace: Workspace,
  db: Db,
  agents: AgentService,
  credentials = new HostCredentialStore(),
): Deploys {
  const getState = <T>(key: string, fallback: T) => workspace.getAppState(key, fallback)
  const setState = (key: string, value: unknown) => workspace.setAppState(key, value)
  const accounts = new HostingAccounts(getState, setState, credentials)
  const service = new DeployService(
    {
      getState,
      setState,
      stackTarget: (projectId) => {
        const stack = workspace.projectConfiguration(projectId).config.stack
        return stack?.deployTarget ?? stack?.id ?? null
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
  return {
    accounts,
    service,
    signIns: new HostingSignIns(accounts),
    domains: new DomainWatches(db, workspace, agents, service),
  }
}
