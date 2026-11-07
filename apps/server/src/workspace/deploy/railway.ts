// Railway's public GraphQL API with the person's own token. Linking creates a Railway project whose service watches the
// GitHub repository through Railway's GitHub app, with pull request environments on, so every pull request gets a
// preview and the default branch deploys to production without a token in CI.
import { apexOf } from '@ramu/shared/domains'
import type { Deployment, DeploymentState, DnsRecord } from '@ramu/shared/types/deploy'
import {
  DeployError,
  graphqlCall,
  registerHostingAdapter,
  tail,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
  type PlatformDomain,
} from './adapter'

interface RailwayDeployment {
  id: string
  status?: string
  createdAt?: string
  environmentId?: string
  serviceId?: string | null
  staticUrl?: string | null
  url?: string | null
  /** Railway's deployment metadata; a GitHub deploy carries its branch and commit. */
  meta?: { branch?: string; commitHash?: string; commitMessage?: string } | null
}

interface RailwayDnsRecord {
  hostlabel?: string
  fqdn?: string
  recordType?: string
  requiredValue?: string
  status?: string
  zone?: string
}

interface RailwayDomains {
  serviceDomains?: { domain: string }[]
  customDomains?: {
    domain: string
    status?: { dnsRecords?: RailwayDnsRecord[]; certificateStatus?: string }
  }[]
}

const STATES: Record<string, DeploymentState> = {
  QUEUED: 'queued',
  WAITING: 'queued',
  INITIALIZING: 'queued',
  NEEDS_APPROVAL: 'queued',
  BUILDING: 'building',
  DEPLOYING: 'building',
  SUCCESS: 'ready',
  SLEEPING: 'ready',
  FAILED: 'failed',
  CRASHED: 'failed',
  REMOVED: 'canceled',
  REMOVING: 'canceled',
  SKIPPED: 'canceled',
}

const RECORD_TYPES: Record<string, DnsRecord['type']> = {
  DNS_RECORD_TYPE_A: 'A',
  DNS_RECORD_TYPE_CNAME: 'CNAME',
  DNS_RECORD_TYPE_TXT: 'TXT',
}

const DEPLOYMENT_FIELDS = 'id status createdAt environmentId serviceId staticUrl url meta'
/** Domains read per service, so a service with many aliases cannot make an endless list. */
const DOMAINS_READ = 20

/**
 * A binding's site id holds the Railway project, its production environment and the service that runs the app. Ids
 * are checked before they are sent anywhere.
 */
function target(site: HostingSite) {
  const [projectId, environmentId, serviceId] = site.siteId.split(':')
  const valid = (id: string | undefined): id is string => !!id && /^[A-Za-z0-9_-]{1,64}$/.test(id)
  if (!valid(projectId) || !valid(environmentId) || !valid(serviceId))
    throw new DeployError('This project’s Railway link is not one Ramu made. Link the project again.', 'not-found')
  return { projectId, environmentId, serviceId }
}

/** Railway, reached at `api` (the real API unless a test points it at a fake server). */
export function railwayAdapter(options: { api?: string; fetch?: typeof fetch } = {}): HostingAdapter {
  const api = options.api ?? 'https://backboard.railway.com/graphql/v2'
  const fetcher = options.fetch ?? fetch
  const gql = <T>(auth: HostingAuth, query: string, variables: Record<string, unknown>, what: string) =>
    graphqlCall<T>('Railway', fetcher, api, { token: auth.token }, query, variables, what)

  const deployment = (raw: RailwayDeployment, site: HostingSite): Deployment => {
    const address = raw.staticUrl ?? raw.url ?? null
    return {
      id: raw.id,
      state: STATES[raw.status ?? 'QUEUED'] ?? 'queued',
      url: address ? `https://${address.replace(/^https?:\/\//, '')}` : null,
      production: raw.environmentId === target(site).environmentId,
      ref: raw.meta?.branch ?? null,
      commit: raw.meta?.commitHash ?? null,
      message: raw.meta?.commitMessage?.split('\n')[0] ?? null,
      createdAt: raw.createdAt ? Date.parse(raw.createdAt) : 0,
    }
  }

  /** One deployment of the bound service; another service's deployment is refused. */
  const read = async (auth: HostingAuth, site: HostingSite, id: string) => {
    const { deployment: found } = await gql<{ deployment: RailwayDeployment }>(
      auth,
      `query Deployment($id: String!) { deployment(id: $id) { ${DEPLOYMENT_FIELDS} } }`,
      { id },
      'reading the deployment',
    )
    if (found.serviceId !== target(site).serviceId)
      throw new DeployError('That is not a deployment of this project.', 'not-found')
    return found
  }

  const domains = async (auth: HostingAuth, site: HostingSite) => {
    const { domains: found } = await gql<{ domains: RailwayDomains }>(
      auth,
      `query Domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          serviceDomains { domain }
          customDomains { domain status { certificateStatus dnsRecords { hostlabel fqdn recordType requiredValue status zone } } }
        }
      }`,
      target(site),
      'reading the domains',
    )
    return found
  }

  return {
    id: 'railway',
    name: 'Railway',
    tokenPage: 'https://railway.com/account/tokens',
    async account(auth) {
      // An account token (or a CLI sign-in) answers `me`; a workspace token cannot, and names its workspace instead.
      const me = await gql<{ me: { id: string; name?: string | null; email?: string; workspaces?: { id: string }[] } }>(
        auth,
        'query Me { me { id name email workspaces { id } } }',
        {},
        'reading the account',
      ).catch((error: unknown) => {
        if (error instanceof DeployError && error.kind === 'missing-permission') return null
        throw error
      })
      if (me)
        return {
          id: me.me.id,
          name: me.me.name || me.me.email || me.me.id,
          defaultScope: me.me.workspaces?.[0]?.id ?? null,
          broadScope:
            'This sign-in reaches every Railway workspace you belong to. A workspace token is enough for deploys.',
          expiresAt: null,
        }
      const { apiToken } = await gql<{ apiToken: { workspaces: { id: string; name: string }[] } }>(
        auth,
        'query Token { apiToken { workspaces { id name } } }',
        {},
        'reading the token',
      )
      const workspace = apiToken.workspaces[0]
      if (!workspace) throw new DeployError('This Railway token reaches no workspace.', 'missing-permission')
      return { id: workspace.id, name: workspace.name, defaultScope: workspace.id, broadScope: null, expiresAt: null }
    },
    async listDeployments(auth, site, limit) {
      const { projectId, serviceId } = target(site)
      // Every environment: production, and the pull request environments whose deployments are the previews.
      const { deployments } = await gql<{ deployments: { edges: { node: RailwayDeployment }[] } }>(
        auth,
        `query Deployments($input: DeploymentListInput!, $first: Int) {
          deployments(input: $input, first: $first) { edges { node { ${DEPLOYMENT_FIELDS} } } }
        }`,
        { input: { projectId, serviceId }, first: limit },
        'listing deployments',
      )
      return deployments.edges
        .map((edge) => deployment(edge.node, site))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
    },
    async deploymentStatus(auth, site, deploymentId) {
      return deployment(await read(auth, site, deploymentId), site)
    },
    async deploymentLogs(auth, site, deploymentId, lines) {
      await read(auth, site, deploymentId)
      const { buildLogs } = await gql<{ buildLogs: { message?: string }[] }>(
        auth,
        'query BuildLogs($deploymentId: String!, $limit: Int) { buildLogs(deploymentId: $deploymentId, limit: $limit) { message } }',
        { deploymentId, limit: lines },
        'reading the build log',
      )
      return tail(buildLogs.map((entry) => entry.message ?? '').join('\n'), lines)
    },
    async productionUrl(auth, site) {
      const found = await domains(auth, site)
      // A custom domain serving HTTPS is the one a person would type; Railway's own domain otherwise.
      const custom = found.customDomains?.find(
        (domain) => domain.status?.certificateStatus === 'CERTIFICATE_STATUS_TYPE_VALID',
      )
      const name = custom?.domain ?? found.serviceDomains?.[0]?.domain
      return name ? `https://${name}` : null
    },
    capabilities: {
      async linkRepository(auth, name, repository) {
        const repo = `${repository.owner}/${repository.name}`
        const { projectCreate: project } = await gql<{
          projectCreate: { id: string; name: string; environments: { edges: { node: { id: string; name: string } }[] } }
        }>(
          auth,
          `mutation ProjectCreate($input: ProjectCreateInput!) {
            projectCreate(input: $input) { id name environments { edges { node { id name } } } }
          }`,
          {
            input: {
              name,
              defaultEnvironmentName: 'production',
              prDeploys: true,
              ...(auth.scope ? { workspaceId: auth.scope } : {}),
            },
          },
          'creating the project',
        )
        const environment = project.environments.edges[0]?.node
        if (!environment) throw new DeployError('Railway created the project without an environment.', null)
        // Railway's GitHub app must be installed for the repository; without it Railway refuses the source.
        const { serviceCreate: service } = await gql<{ serviceCreate: { id: string } }>(
          auth,
          'mutation ServiceCreate($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
          {
            input: {
              projectId: project.id,
              name: repository.name,
              source: { repo },
              branch: repository.productionBranch,
            },
          },
          'connecting the repository',
        ).catch((error: unknown) => {
          if (error instanceof DeployError && error.kind !== 'signed-out')
            throw new DeployError(
              `Railway cannot reach ${repo}. Install Railway's GitHub app for that repository (https://github.com/apps/railway-app) and link again.`,
              'missing-permission',
              error.status,
              { cause: error },
            )
          throw error
        })
        // A Railway service has no public address until it is given one.
        await gql(
          auth,
          'mutation ServiceDomainCreate($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }',
          { input: { serviceId: service.id, environmentId: environment.id } },
          'creating the public address',
        )
        return { siteId: `${project.id}:${environment.id}:${service.id}`, siteName: project.name }
      },
      async deployProduction(auth, site) {
        const { environmentId, serviceId } = target(site)
        const { serviceInstanceDeployV2: id } = await gql<{ serviceInstanceDeployV2: string }>(
          auth,
          'mutation Deploy($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }',
          { environmentId, serviceId },
          'starting the deployment',
        )
        return deployment(await read(auth, site, id), site)
      },
      async rollback(auth, site, deploymentId) {
        await read(auth, site, deploymentId)
        await gql(
          auth,
          'mutation Rollback($id: String!) { deploymentRollback(id: $id) }',
          { id: deploymentId },
          'rolling back',
        )
      },
      environment: {
        // Pull request environments copy production's variables, so production is the one place Ramu writes.
        environments: ['production'],
        async list(auth, site) {
          const { variables } = await gql<{ variables: Record<string, unknown> }>(
            auth,
            'query Variables($projectId: String!, $environmentId: String!, $serviceId: String) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }',
            target(site),
            'reading the variables',
          )
          // Railway answers with values too; only the names leave this function.
          return { production: Object.keys(variables ?? {}) }
        },
        async set(auth, site, _environment, values) {
          if (!Object.keys(values).length) return
          await gql(
            auth,
            'mutation Variables($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }',
            { input: { ...target(site), variables: values } },
            'setting the variables',
          )
        },
      },
      domains: {
        async list(auth, site) {
          const found = await domains(auth, site)
          return (found.customDomains ?? []).slice(0, DOMAINS_READ).map((domain): PlatformDomain => {
            const shown = (domain.status?.dnsRecords ?? []).flatMap((record): (DnsRecord & { done: boolean })[] => {
              const type = RECORD_TYPES[record.recordType ?? '']
              if (!type || !record.requiredValue) return []
              return [
                {
                  type,
                  host: record.fqdn || domain.domain,
                  name: record.hostlabel || '@',
                  value: record.requiredValue,
                  done: record.status === 'DNS_RECORD_STATUS_PROPAGATED',
                },
              ]
            })
            return {
              name: domain.domain,
              records: shown.map(({ done: _done, ...record }) => record),
              configured: shown.length ? shown.every((record) => record.done) : null,
              certificate: domain.status?.certificateStatus === 'CERTIFICATE_STATUS_TYPE_VALID',
              managedDns: false,
              zone: domain.status?.dnsRecords?.find((record) => record.zone)?.zone ?? apexOf(domain.domain),
            }
          })
        },
        async add(auth, site, name) {
          await gql(
            auth,
            'mutation CustomDomainCreate($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id } }',
            { input: { ...target(site), domain: name } },
            'adding the domain',
          )
        },
        async createRecords() {
          throw new Error('Railway does not host DNS. Add the records at your domain provider.')
        },
      },
      async usage(auth, site) {
        // Railway reports what the project used in its owner's current billing period; the period itself is on the
        // workspace's billing record, which a member without billing access cannot read.
        const { projectId } = target(site)
        const [{ usage }, period] = await Promise.all([
          gql<{ usage: { measurement: string; value: number }[] }>(
            auth,
            'query Usage($projectId: String!) { usage(projectId: $projectId, measurements: [NETWORK_TX_GB]) { measurement value } }',
            { projectId },
            'reading usage',
          ),
          gql<{ project: { workspace?: { customer?: { billingPeriod?: { start?: string; end?: string } } } | null } }>(
            auth,
            'query Billing($id: String!) { project(id: $id) { workspace { customer { billingPeriod { start end } } } } }',
            { id: projectId },
            'reading the billing period',
          ).catch(() => null),
        ])
        const egress = usage.find((entry) => entry.measurement === 'NETWORK_TX_GB')
        const billing = period?.project.workspace?.customer?.billingPeriod
        const start = billing?.start ? Date.parse(billing.start) : NaN
        const end = billing?.end ? Date.parse(billing.end) : NaN
        return {
          period: Number.isNaN(start) ? null : { start, end: Number.isNaN(end) ? null : end },
          figures: egress
            ? [{ metric: 'transfer', service: null, used: Math.round(egress.value * 1e9), unit: 'bytes', limit: null }]
            : [],
          billingPage: 'https://railway.com/workspace/usage',
        }
      },
    },
  }
}

registerHostingAdapter(railwayAdapter())
