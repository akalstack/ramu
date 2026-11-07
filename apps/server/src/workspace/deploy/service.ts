// Deploys for a project: where it is bound, what is live, and the actions the bound platform declares. Every action
// checks the binding against the account that is connected now, so a project linked under one account is never
// deployed or rolled back with another.
import { STACKS, type DeployTargetId, type StackId } from '@ramu/shared/stacks'
import { domainName } from '@ramu/shared/domains'
import type {
  Deployment,
  DeployBinding,
  DomainStatus,
  HostingPlatform,
  ProjectDeployment,
} from '@ramu/shared/types/deploy'
import { HOSTING_PLATFORMS } from '@ramu/shared/types/deploy'
import {
  capabilityNames,
  DeployError,
  hostingAdapter,
  ReplyLostError,
  type HostingAdapter,
  type HostingAuth,
  type PlatformDomain,
  type RepositoryLink,
} from './adapter'
import type { HostingAccounts } from './accounts'
import { liveProbes, type DomainProbes } from './domains'
import type { EnvTarget } from './envSync'

const LISTED = 10
const LOG_LINES = 200

/** What the service needs from the workspace, so tests can give it a project without a database. */
export interface DeployHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** The stack's deploy target from the project's `ramu.json`, if any. */
  stackTarget(projectId: string): string | null
  /** A repository of the project as a GitHub repository, with the token of the account that reaches it. */
  githubRepository(projectId: string, repoId: string): Promise<RepositoryLink>
  /** Runs before a production deploy starts (the project's migrations); a failure stops the deploy. */
  beforeProduction?(projectId: string, binding: DeployBinding): Promise<void>
}

const key = (projectId: string) => `deploy-binding:${projectId}`

export class DeployService {
  constructor(
    private readonly host: DeployHost,
    private readonly accounts: HostingAccounts,
    private readonly adapter: (platform: HostingPlatform) => HostingAdapter = hostingAdapter,
    private readonly probes: DomainProbes = liveProbes,
  ) {}

  binding(projectId: string): DeployBinding | null {
    return this.host.getState<DeployBinding | null>(key(projectId), null)
  }

  private recommended(projectId: string): DeployTargetId | null {
    const target = this.host.stackTarget(projectId)
    if (!target) return null
    if (target in STACKS) return STACKS[target as StackId].deployTarget
    return target as DeployTargetId
  }

  /** The binding and the connected account's token, refused when the account changed since the link. */
  private async bound(projectId: string): Promise<{ binding: DeployBinding; auth: HostingAuth }> {
    const binding = this.binding(projectId)
    if (!binding) throw new Error('This project has no deploy target yet. Open Deploy on the project to link one.')
    const { auth, accountId } = await this.accounts.auth(binding.platform)
    if (accountId && accountId !== binding.accountId)
      throw new DeployError(
        `This project is linked under another ${this.adapter(binding.platform).name} account. Connect that account, or link the project again.`,
        'missing-permission',
      )
    return { binding, auth: { ...auth, scope: binding.scope } }
  }

  async project(projectId: string): Promise<ProjectDeployment> {
    const binding = this.binding(projectId)
    const empty: ProjectDeployment = {
      recommended: this.recommended(projectId),
      binding,
      capabilities: binding ? capabilityNames(this.adapter(binding.platform)) : [],
      productionUrl: null,
      deployments: [],
      error: null,
    }
    if (!binding) return empty
    try {
      const { auth } = await this.bound(projectId)
      const adapter = this.adapter(binding.platform)
      const [productionUrl, deployments] = await Promise.all([
        adapter.productionUrl(auth, binding),
        adapter.listDeployments(auth, binding, LISTED),
      ])
      return { ...empty, productionUrl, deployments }
    } catch (error) {
      return {
        ...empty,
        error: {
          kind: error instanceof DeployError ? error.kind : null,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /** Links a repository through the platform's Git integration and remembers the binding. */
  async link(projectId: string, platform: HostingPlatform, repoId: string, name: string): Promise<ProjectDeployment> {
    if (!HOSTING_PLATFORMS.includes(platform)) throw new Error('Choose a supported platform.')
    const adapter = this.adapter(platform)
    const link = adapter.capabilities.linkRepository
    if (!link) throw new Error(`${adapter.name} cannot watch a repository from Ramu yet.`)
    const repository = await this.host.githubRepository(projectId, repoId)
    const { auth, accountId, defaultScope } = await this.accounts.auth(platform)
    const scoped = { ...auth, scope: defaultScope }
    const site = await link(scoped, name, repository)
    this.host.setState(key(projectId), {
      platform,
      siteId: site.siteId,
      siteName: site.siteName,
      repository: `${repository.owner}/${repository.name}`,
      productionBranch: repository.productionBranch,
      accountId: accountId ?? (await adapter.account(auth)).id,
      scope: defaultScope,
    } satisfies DeployBinding)
    return this.project(projectId)
  }

  /**
   * Deploys `ref` (production when asked). A reply that never arrives may still have started a deployment, so the
   * list is read again and a deployment of the same ref started since is reported instead of deploying twice.
   */
  async deploy(projectId: string, ref: string | null, production: boolean): Promise<Deployment> {
    const { binding, auth } = await this.bound(projectId)
    const adapter = this.adapter(binding.platform)
    const run = production ? adapter.capabilities.deployProduction : adapter.capabilities.deployPreview
    if (!run)
      throw new Error(
        production
          ? `${adapter.name} deploys this project when its default branch changes.`
          : `${adapter.name} builds previews from pull requests: push the branch and open one.`,
      )
    if (!binding.repository) throw new Error('Link a repository before deploying.')
    if (production) await this.host.beforeProduction?.(projectId, binding)
    const branch = ref ?? binding.productionBranch
    const since = Date.now() - 5_000
    try {
      return await run(auth, { ...binding, repository: binding.repository }, branch)
    } catch (error) {
      if (!(error instanceof ReplyLostError)) throw error
      const started = (await adapter.listDeployments(auth, binding, LISTED)).find(
        (deployment) =>
          deployment.createdAt >= since &&
          deployment.production === production &&
          (!deployment.ref || deployment.ref === branch),
      )
      if (started) return started
      throw new Error(
        `${adapter.name} did not answer, and no new deployment is listed. Check the deployments before trying again.`,
        { cause: error },
      )
    }
  }

  /** The bound platform's preview and production variables, when the platform keeps them. */
  envTarget(projectId: string): EnvTarget | null {
    const binding = this.binding(projectId)
    if (!binding) return null
    const adapter = this.adapter(binding.platform)
    const environment = adapter.capabilities.environment
    if (!environment) return null
    return {
      id: binding.platform,
      name: adapter.name,
      environments: ['preview', 'production'],
      list: async () => environment.list((await this.bound(projectId)).auth, binding),
      set: async (target, values) => {
        if (target !== 'preview' && target !== 'production')
          throw new Error(`${adapter.name} has no ${target} variables.`)
        await environment.set((await this.bound(projectId)).auth, binding, target, values)
      },
    }
  }

  async logs(projectId: string, deploymentId: string): Promise<string> {
    const { binding, auth } = await this.bound(projectId)
    return this.adapter(binding.platform).deploymentLogs(auth, binding, deploymentId, LOG_LINES)
  }

  /** Rolls production back to an earlier production deployment of this project. */
  async rollback(projectId: string, deploymentId: string): Promise<void> {
    const { binding, auth } = await this.bound(projectId)
    const adapter = this.adapter(binding.platform)
    if (!adapter.capabilities.rollback) throw new Error(`${adapter.name} cannot roll back from Ramu.`)
    const target = await adapter.deploymentStatus(auth, binding, deploymentId)
    if (!target.production || target.state !== 'ready')
      throw new Error('Choose an earlier production deployment that finished building.')
    try {
      await adapter.capabilities.rollback(auth, binding, deploymentId)
    } catch (error) {
      // Rolling back twice to the same deployment changes nothing, so a lost reply is safe to report as unknown.
      if (error instanceof ReplyLostError)
        throw new Error(`${adapter.name} did not answer. Check the live site before trying again.`, { cause: error })
      throw error
    }
  }

  /** The bound platform's name, such as "Vercel", for cards that name where a change happens. */
  platformName(projectId: string): string | null {
    const binding = this.binding(projectId)
    return binding ? this.adapter(binding.platform).name : null
  }

  private async domainAccess(projectId: string) {
    const { binding, auth } = await this.bound(projectId)
    const adapter = this.adapter(binding.platform)
    const domains = adapter.capabilities.domains
    if (!domains) throw new Error(`${adapter.name} cannot add domains from Ramu yet.`)
    return { binding, auth, adapter, domains }
  }

  /** What the platform does not report is checked here: the DNS first, and HTTPS only once the DNS points there. */
  private async settle({ zone: _zone, ...domain }: PlatformDomain): Promise<DomainStatus> {
    const pointing = domain.records.filter((record) => record.type !== 'TXT')
    const configured =
      domain.configured ??
      (domain.certificate === true ||
        (pointing.length > 0 &&
          (await Promise.all(pointing.map((record) => this.probes.resolves(record)))).every(Boolean)))
    const certificate = domain.certificate ?? (configured && (await this.probes.https(domain.name)))
    return { ...domain, configured, certificate }
  }

  async domains(projectId: string): Promise<DomainStatus[]> {
    const { binding, auth, domains } = await this.domainAccess(projectId)
    return Promise.all((await domains.list(auth, binding)).map((domain) => this.settle(domain)))
  }

  /**
   * Adds a custom domain to the project. Adding one that is already there, or one whose reply was lost after the
   * platform added it, reports the domain instead of failing.
   */
  async addDomain(projectId: string, input: string): Promise<DomainStatus> {
    const name = domainName(input)
    if (!name) throw new Error('Enter a domain name such as www.example.com.')
    const { binding, auth, adapter, domains } = await this.domainAccess(projectId)
    let failure: unknown = null
    await domains.add(auth, binding, name).catch((error: unknown) => {
      failure = error
    })
    const added = (await domains.list(auth, binding)).find((domain) => domain.name === name)
    if (added) return this.settle(added)
    if (failure instanceof ReplyLostError)
      throw new Error(`${adapter.name} did not answer, and ${name} is not listed. Try adding it again.`, {
        cause: failure,
      })
    throw failure ?? new Error(`${adapter.name} did not list ${name} after adding it.`)
  }

  /** Creates a domain's records in the platform's own DNS, for a domain whose DNS is hosted there. */
  async createRecords(projectId: string, name: string): Promise<DomainStatus> {
    const { binding, auth, adapter, domains } = await this.domainAccess(projectId)
    const domain = (await domains.list(auth, binding)).find((entry) => entry.name === name)
    if (!domain) throw new Error(`${name} is not a domain of this project. Add it first.`)
    if (!domain.managedDns)
      throw new Error(`${name} does not use ${adapter.name} DNS. Add the records at your domain provider.`)
    await domains.createRecords(auth, binding, domain)
    const after = (await domains.list(auth, binding)).find((entry) => entry.name === name)
    return this.settle(after ?? domain)
  }
}
