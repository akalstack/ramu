// The contract every hosting adapter passes: required reads, declared capabilities, a deploy whose reply is lost,
// and failures mapped to the shared kinds. Each adapter runs against a local fake server with recorded replies.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deployment, DeployBinding, DnsRecord, HostingCapability, UsageFigure } from '@ramu/shared/types/deploy'
import { capabilityNames, DeployError, type HostingAdapter, type HostingSite } from '../src/workspace/deploy/adapter'
import { flyAdapter, flyApi, flyAuthorization } from '../src/workspace/deploy/fly'
import { netlifyAdapter } from '../src/workspace/deploy/netlify'
import { railwayAdapter } from '../src/workspace/deploy/railway'
import { serverAdapter } from '../src/workspace/deploy/server'
import type { SshRunner } from '../src/workspace/deploy/ssh'
import { DeployService } from '../src/workspace/deploy/service'
import { vercelAdapter } from '../src/workspace/deploy/vercel'

interface Route {
  /** Names the production deploy, so a test can lose its reply. */
  id?: 'deploy'
  method: string
  path: RegExp
  status?: number
  body?: unknown
  /** Runs before answering, as the platform would act on the request. */
  effect?: () => void
  /** Closes the connection instead of answering: the platform acted, the reply is lost. */
  drop?: boolean
  /** A body sent as it is, for replies that are not one JSON document. */
  raw?: string
  /** For a GraphQL API, where every call is one POST: the operation name the request must carry. */
  operation?: string
  /** A body made from the request's GraphQL variables, for replies that depend on them. */
  answer?(variables: Record<string, unknown>): unknown
}

interface Fake {
  url: string
  requests: string[]
  routes: Route[]
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fake(routes: Route[]): Promise<Fake> {
  const state: Fake = { url: '', requests: [], routes }
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toMatch(/^(Bearer|FlyV1) \S+/)
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    req.on('end', () => {
      // A GraphQL call is named by its operation, such as `POST /graphql mutation Rollback`.
      let request: { query?: unknown; variables?: Record<string, unknown> } = {}
      try {
        request = JSON.parse(body) as typeof request
      } catch {
        // Not a JSON body: a REST call without one.
      }
      const operation = /^\s*(query|mutation) (\w+)/.exec(String(request.query ?? ''))
      const line = `${req.method} ${req.url}${operation ? ` ${operation[1]} ${operation[2]}` : ''}`
      state.requests.push(line)
      const route = state.routes.find(
        (entry) =>
          entry.method === req.method &&
          entry.path.test(req.url ?? '') &&
          (!entry.operation || entry.operation === operation?.[2]),
      )
      if (!route) return void res.writeHead(500).end(`no recorded reply for ${line}`)
      route.effect?.()
      if (route.drop) return void req.socket.destroy()
      res
        .writeHead(route.status ?? 200, { 'Content-Type': 'application/json' })
        .end(route.raw ?? JSON.stringify(route.answer?.(request.variables ?? {}) ?? route.body ?? {}))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return state
}

/** One adapter's recorded replies, shaped like the platform's own. */
interface Contract {
  name: string
  platform: DeployBinding['platform']
  make(url: string): HostingAdapter
  site: HostingSite
  capabilities: HostingCapability[]
  routes(list: unknown[], created: unknown): Route[]
  first: unknown
  created: unknown
  createdId: string
  /** The first deployment's id, which a rollback puts back. */
  firstId: string
  productionUrl: string
  logTail: string
  /** The usage the recorded replies report, figures and billing page. */
  usage: { figures: UsageFigure[]; billingPage: RegExp }
}

const now = Date.now()
const contracts: Contract[] = [
  {
    name: 'Vercel',
    platform: 'vercel',
    make: (url) => vercelAdapter({ api: url }),
    site: { siteId: 'prj_1', siteName: 'shop' },
    capabilities: ['linkRepository', 'deployPreview', 'deployProduction', 'rollback', 'domains', 'usage'],
    first: {
      uid: 'dpl_1',
      url: 'shop-abc.vercel.app',
      readyState: 'READY',
      target: 'production',
      created: now - 60_000,
      meta: { githubCommitRef: 'main', githubCommitSha: 'aaa', githubCommitMessage: 'First\n\nbody' },
    },
    created: {
      uid: 'dpl_2',
      url: 'shop-def.vercel.app',
      readyState: 'BUILDING',
      target: 'production',
      created: now,
      meta: { githubCommitRef: 'main' },
    },
    createdId: 'dpl_2',
    firstId: 'dpl_1',
    productionUrl: 'https://shop.example.com',
    logTail: 'Error: build failed',
    // Charges add up per service and unit; credits and purchases are not usage.
    usage: {
      figures: [
        { metric: 'service', service: 'Fast Data Transfer', used: 1.5, unit: 'GB', limit: null },
        { metric: 'service', service: 'Function Invocations', used: 3000, unit: 'Invocations', limit: null },
      ],
      billingPage: /^https:\/\/vercel\.com\//,
    },
    routes: (list, created) => [
      {
        method: 'GET',
        path: /^\/v1\/billing\/charges\?from=.*&to=/,
        raw: [
          { ChargeCategory: 'Usage', ServiceName: 'Fast Data Transfer', ConsumedQuantity: 1, ConsumedUnit: 'GB' },
          { ChargeCategory: 'Usage', ServiceName: 'Fast Data Transfer', ConsumedQuantity: 0.5, ConsumedUnit: 'GB' },
          {
            ChargeCategory: 'Usage',
            ServiceName: 'Function Invocations',
            ConsumedQuantity: 3000,
            ConsumedUnit: 'Invocations',
          },
          { ChargeCategory: 'Credit', ServiceName: 'Pro Plan', ConsumedQuantity: null, ConsumedUnit: null },
        ]
          .map((row) => JSON.stringify({ BilledCost: 0, BillingCurrency: 'USD', ...row }))
          .join('\n'),
      },
      { method: 'GET', path: /^\/v2\/user$/, body: { user: { id: 'u1', username: 'ana', defaultTeamId: 'team_1' } } },
      { method: 'GET', path: /^\/v5\/user\/tokens\/current$/, body: { token: { scopes: [{ type: 'user' }] } } },
      { method: 'GET', path: /^\/v6\/deployments\?projectId=prj_1/, body: { deployments: list } },
      { method: 'GET', path: /^\/v13\/deployments\/dpl_1$/, body: list[0] },
      {
        method: 'GET',
        path: /^\/v3\/deployments\/dpl_1\/events/,
        body: [
          { type: 'stdout', payload: { text: 'Installing' } },
          { type: 'stderr', payload: { text: 'Error: build failed' } },
        ],
      },
      {
        method: 'GET',
        path: /^\/v9\/projects\/prj_1\/domains$/,
        body: {
          domains: [
            { name: 'shop-ana.vercel.app', verified: true },
            { name: 'shop.example.com', verified: true },
          ],
        },
      },
      { method: 'GET', path: /^\/v9\/projects\/shop/, status: 404, body: { error: { code: 'not_found' } } },
      { method: 'POST', path: /^\/v11\/projects/, body: { id: 'prj_1', name: 'shop' } },
      {
        id: 'deploy',
        method: 'POST',
        path: /^\/v13\/deployments$/,
        body: created,
        effect: () => list.unshift(created),
      },
      { method: 'POST', path: /^\/v9\/projects\/prj_1\/rollback\/dpl_1$/, body: {} },
    ],
  },
  {
    name: 'Netlify',
    platform: 'netlify',
    make: (url) => netlifyAdapter({ api: url, github: `${url}/gh` }),
    site: { siteId: 'site_1', siteName: 'shop' },
    capabilities: ['linkRepository', 'deployProduction', 'rollback', 'domains', 'usage'],
    first: {
      id: 'd1',
      state: 'ready',
      context: 'production',
      branch: 'main',
      commit_ref: 'aaa',
      title: 'First',
      created_at: new Date(now - 60_000).toISOString(),
      deploy_ssl_url: 'https://d1--shop.netlify.app',
      build_id: 'b1',
    },
    created: {
      id: 'd2',
      state: 'building',
      context: 'production',
      branch: 'main',
      created_at: new Date(now).toISOString(),
      deploy_ssl_url: 'https://d2--shop.netlify.app',
    },
    createdId: 'd2',
    firstId: 'd1',
    productionUrl: 'https://shop.netlify.app',
    logTail: 'Failed: exit 2',
    usage: {
      figures: [{ metric: 'build-minutes', service: null, used: 240, unit: 'minutes', limit: 300 }],
      billingPage: /^https:\/\/app\.netlify\.com\/teams\/ana-team\/billing/,
    },
    routes: (list, created) => [
      {
        method: 'GET',
        path: /^\/acc_1\/builds\/status$/,
        body: [
          {
            active: 0,
            pending_concurrency: 0,
            enqueued: 0,
            build_count: 12,
            minutes: {
              current: 240,
              current_average_sec: 60,
              previous: 100,
              period_start_date: '2026-11-01T00:00:00Z',
              period_end_date: '2026-12-01T00:00:00Z',
              last_updated_at: '2026-11-07T00:00:00Z',
              included_minutes: '300',
              included_minutes_with_packs: '300',
            },
          },
        ],
      },
      { method: 'GET', path: /^\/user$/, body: { id: 'u1', full_name: 'Ana' } },
      { method: 'GET', path: /^\/sites\/site_1\/deploys\?per_page=/, body: list },
      { method: 'GET', path: /^\/sites\/site_1\/deploys\/d1$/, body: list.at(-1) },
      { method: 'GET', path: /^\/sites\/site_1\/deploys\/d2$/, body: created },
      { method: 'GET', path: /^\/builds\/b1\/log$/, body: [{ message: 'Building' }, { message: 'Failed: exit 2' }] },
      {
        method: 'GET',
        path: /^\/sites\/site_1$/,
        body: { ssl_url: 'https://shop.netlify.app', account_id: 'acc_1', account_slug: 'ana-team' },
      },
      { method: 'GET', path: /^\/gh\/repos\/ana\/shop$/, body: { id: 7, full_name: 'ana/shop' } },
      { method: 'POST', path: /^\/deploy_keys$/, body: { id: 'k1', public_key: 'ssh-ed25519 AAAA' } },
      { method: 'POST', path: /^\/gh\/repos\/ana\/shop\/keys$/, status: 201, body: { id: 1 } },
      {
        method: 'POST',
        path: /^\/sites$/,
        body: { id: 'site_1', name: 'shop', deploy_hook: 'https://api.netlify.com/hooks/x' },
      },
      // GitHub answers 422 when the same webhook already exists; linking again is not a failure.
      {
        method: 'POST',
        path: /^\/gh\/repos\/ana\/shop\/hooks$/,
        status: 422,
        body: { message: 'Hook already exists' },
      },
      {
        id: 'deploy',
        method: 'POST',
        path: /^\/sites\/site_1\/builds$/,
        body: { id: 'b2', deploy_id: 'd2' },
        effect: () => list.unshift(created),
      },
      { method: 'POST', path: /^\/sites\/site_1\/deploys\/d1\/restore$/, body: {} },
    ],
  },
  {
    name: 'Railway',
    platform: 'railway',
    make: (url) => railwayAdapter({ api: `${url}/graphql` }),
    site: { siteId: 'prj_1:env_prod:svc_1', siteName: 'shop' },
    capabilities: ['linkRepository', 'deployProduction', 'rollback', 'domains', 'usage'],
    first: {
      id: 'dep_1',
      status: 'SUCCESS',
      createdAt: new Date(now - 60_000).toISOString(),
      environmentId: 'env_prod',
      serviceId: 'svc_1',
      staticUrl: 'shop-production.up.railway.app',
      meta: { branch: 'main', commitHash: 'aaa', commitMessage: 'First\n\nbody' },
    },
    created: {
      id: 'dep_2',
      status: 'BUILDING',
      createdAt: new Date(now).toISOString(),
      environmentId: 'env_prod',
      serviceId: 'svc_1',
      meta: { branch: 'main' },
    },
    createdId: 'dep_2',
    firstId: 'dep_1',
    productionUrl: 'https://shop.example.com',
    logTail: 'Build failed',
    usage: {
      figures: [{ metric: 'transfer', service: null, used: 1_500_000_000, unit: 'bytes', limit: null }],
      billingPage: /^https:\/\/railway\.com\//,
    },
    routes: (list, created) => {
      const graphql = (operation: string, data: unknown, extra: Partial<Route> = {}): Route => ({
        method: 'POST',
        path: /^\/graphql$/,
        operation,
        body: { data },
        ...extra,
      })
      return [
        graphql('Me', { me: { id: 'u1', name: 'Ana', email: 'ana@example.com', workspaces: [{ id: 'ws_1' }] } }),
        graphql('Deployments', null, {
          answer: () => ({ data: { deployments: { edges: list.map((node) => ({ node })) } } }),
        }),
        graphql('Deployment', null, {
          answer: ({ id }) => ({
            data: { deployment: [...list, created].find((entry) => (entry as { id: string }).id === id) },
          }),
        }),
        graphql('BuildLogs', { buildLogs: [{ message: 'Installing' }, { message: 'Build failed' }] }),
        graphql('Domains', {
          domains: {
            serviceDomains: [{ domain: 'shop-production.up.railway.app' }],
            customDomains: [
              {
                domain: 'shop.example.com',
                status: { certificateStatus: 'CERTIFICATE_STATUS_TYPE_VALID', dnsRecords: [] },
              },
            ],
          },
        }),
        graphql('ProjectCreate', {
          projectCreate: { id: 'prj_1', name: 'shop', environments: { edges: [{ node: { id: 'env_prod' } }] } },
        }),
        graphql('ServiceCreate', { serviceCreate: { id: 'svc_1' } }),
        graphql('ServiceDomainCreate', { serviceDomainCreate: { domain: 'shop-production.up.railway.app' } }),
        graphql('Deploy', { serviceInstanceDeployV2: 'dep_2' }, { id: 'deploy', effect: () => list.unshift(created) }),
        graphql('Rollback', { deploymentRollback: true }),
        graphql('Usage', { usage: [{ measurement: 'NETWORK_TX_GB', value: 1.5 }] }),
        graphql('Billing', {
          project: {
            workspace: {
              customer: { billingPeriod: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' } },
            },
          },
        }),
      ]
    },
  },
]

const auth = { token: 'tok_123' }
/** A request that changes something: any POST to a REST API, a mutation to a GraphQL one. */
const writes = (line: string) =>
  / (query|mutation) \w+$/.test(line) ? / mutation /.test(line) : line.startsWith('POST')
const repository = { owner: 'ana', name: 'shop', githubToken: async () => 'gh_123', productionBranch: 'main' }

describe.each(contracts)('$name hosting adapter', (contract) => {
  const setup = async () => {
    const list: unknown[] = [contract.first]
    const server = await fake(contract.routes(list, contract.created))
    return { server, list, adapter: contract.make(server.url) }
  }

  it('answers every required read in the shared shapes', async () => {
    const { adapter } = await setup()
    const identity = await adapter.account(auth)
    expect(identity.id).toBe('u1')
    expect(identity.name).toBeTruthy()
    const deployments = await adapter.listDeployments(auth, contract.site, 10)
    expect(deployments).toHaveLength(1)
    expect(deployments[0]).toMatchObject({ state: 'ready', production: true, ref: 'main', commit: 'aaa' })
    expect(deployments[0]!.message).toBe('First')
    expect(deployments[0]!.url).toMatch(/^https:\/\//)
    const status = await adapter.deploymentStatus(auth, contract.site, deployments[0]!.id)
    expect(status.id).toBe(deployments[0]!.id)
    expect(await adapter.deploymentLogs(auth, contract.site, deployments[0]!.id, 1)).toBe(contract.logTail)
    expect(await adapter.productionUrl(auth, contract.site)).toBe(contract.productionUrl)
  })

  it('declares only the capabilities it implements, and each one works', async () => {
    const { adapter, server } = await setup()
    expect(capabilityNames(adapter)).toEqual(contract.capabilities)
    const site = await adapter.capabilities.linkRepository!(auth, 'shop', repository)
    expect(site).toEqual(contract.site)
    const bound = { ...site, repository: 'ana/shop' }
    if (adapter.capabilities.deployPreview)
      expect((await adapter.capabilities.deployPreview(auth, bound, 'feature')).id).toBeTruthy()
    const deployed: Deployment = await adapter.capabilities.deployProduction!(auth, bound, 'main')
    expect(deployed).toMatchObject({ id: contract.createdId, production: true })
    await adapter.capabilities.rollback!(auth, site, contract.firstId)
    // Tokens go only in the Authorization header, never in a URL.
    expect(server.requests.join('\n')).not.toContain('tok_123')
  })

  it('reports only the usage figures and limits the platform’s API returns', async () => {
    const { adapter, server } = await setup()
    const usage = await adapter.capabilities.usage!(auth, contract.site)
    expect(usage.figures).toEqual(contract.usage.figures)
    expect(usage.billingPage).toMatch(contract.usage.billingPage)
    expect(usage.period?.start).toBeGreaterThan(0)
    expect(server.requests.join('\n')).not.toContain('tok_123')
  })

  it('reads the list again when a deploy reply is lost, and never deploys twice', async () => {
    const { adapter, server } = await setup()
    server.routes.find((route) => route.id === 'deploy')!.drop = true
    const binding: DeployBinding = {
      platform: contract.platform,
      ...contract.site,
      repository: 'ana/shop',
      productionBranch: 'main',
      accountId: 'u1',
      scope: null,
    }
    const service = new DeployService(
      {
        getState: <T>() => binding as T,
        setState: () => {},
        stackTarget: () => null,
        githubToken: async () => 'gh_123',
        githubRepository: async () => repository,
      },
      { auth: async () => ({ auth, accountId: 'u1', defaultScope: null }) } as never,
      () => adapter,
    )
    const result = await service.deploy('project', null, true)
    expect(result.id).toBe(contract.createdId)
    expect(server.requests.filter(writes)).toHaveLength(1)
    // The answer came from reading the deployments again after the lost reply.
    expect(server.requests.at(-1)).toMatch(/deployments\?projectId|deploys\?per_page|query Deployments$/)
  })

  it('refuses to act under another account than the one that linked the project', async () => {
    const { adapter, server } = await setup()
    const service = new DeployService(
      {
        getState: <T>() =>
          ({
            platform: 'vercel',
            ...contract.site,
            repository: 'ana/shop',
            productionBranch: 'main',
            accountId: 'someone-else',
            scope: null,
          }) as T,
        setState: () => {},
        stackTarget: () => null,
        githubToken: async () => 'gh_123',
        githubRepository: async () => repository,
      },
      { auth: async () => ({ auth, accountId: 'u1', defaultScope: null }) } as never,
      () => adapter,
    )
    await expect(service.deploy('project', null, true)).rejects.toMatchObject({ kind: 'missing-permission' })
    expect(server.requests.filter(writes)).toHaveLength(0)
  })

  it.each([
    [401, '{}', 'signed-out'],
    [403, '{"error":{"code":"forbidden"}}', 'missing-permission'],
    [402, '{}', 'plan-limit'],
    [400, '{"error":{"message":"You have exceeded the deployment limit"}}', 'plan-limit'],
    [404, '{}', 'not-found'],
    [500, '{"secret":"echoed tok_123"}', null],
  ])('maps %i to the shared failure kind', async (status, body, kind) => {
    const server = await fake(
      ['GET', 'POST'].map((method) => ({ method, path: /./, status, body: JSON.parse(body) as unknown })),
    )
    const failure = await contract
      .make(server.url)
      .listDeployments(auth, contract.site, 5)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DeployError)
    expect((failure as DeployError).kind).toBe(kind)
    // The platform's own error text is never passed on.
    expect((failure as Error).message).not.toContain('tok_123')
  })
})

/** One adapter's recorded domain replies: www.shop.id on DNS elsewhere, shop.example.com on the platform's own DNS. */
interface DomainContract {
  name: string
  make(url: string): HostingAdapter
  site: HostingSite
  routes(created: string[]): Route[]
  /** The records the platform asks for, by domain. */
  records: Record<string, DnsRecord[]>
  external: { configured: boolean | null; certificate: boolean | null }
  managed: { configured: boolean | null; certificate: boolean | null }
}

const domainContracts: DomainContract[] = [
  {
    name: 'Vercel',
    make: (url) => vercelAdapter({ api: url }),
    site: { siteId: 'prj_1', siteName: 'shop' },
    routes: (created) => [
      {
        method: 'GET',
        path: /^\/v9\/projects\/prj_1\/domains$/,
        body: {
          domains: [
            { name: 'shop-ana.vercel.app', apexName: 'vercel.app', verified: true },
            {
              name: 'www.shop.id',
              apexName: 'shop.id',
              verified: false,
              verification: [{ type: 'TXT', domain: '_vercel.shop.id', value: 'vc-domain-verify=www.shop.id,abc' }],
            },
            { name: 'shop.example.com', apexName: 'example.com', verified: true },
          ],
        },
      },
      {
        method: 'GET',
        path: /^\/v6\/domains\/www\.shop\.id\/config$/,
        body: { misconfigured: true, recommendedCNAME: [{ rank: 1, value: 'abc123.vercel-dns-017.com.' }] },
      },
      {
        method: 'GET',
        path: /^\/v6\/domains\/shop\.example\.com\/config$/,
        body: { misconfigured: false, recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com.' }] },
      },
      { method: 'GET', path: /^\/v5\/domains\/shop\.id$/, status: 404, body: { error: { code: 'not_found' } } },
      { method: 'GET', path: /^\/v5\/domains\/example\.com$/, body: { domain: { serviceType: 'zeit.world' } } },
      { method: 'POST', path: /^\/v10\/projects\/prj_1\/domains$/, body: { name: 'www.shop.id' } },
      {
        method: 'POST',
        path: /^\/v2\/domains\/example\.com\/records$/,
        body: { uid: 'rec_1' },
        effect: () => created.push('example.com'),
      },
    ],
    records: {
      'www.shop.id': [
        { type: 'CNAME', host: 'www.shop.id', name: 'www', value: 'abc123.vercel-dns-017.com' },
        { type: 'TXT', host: '_vercel.shop.id', name: '_vercel', value: 'vc-domain-verify=www.shop.id,abc' },
      ],
      'shop.example.com': [{ type: 'CNAME', host: 'shop.example.com', name: 'shop', value: 'cname.vercel-dns.com' }],
    },
    external: { configured: false, certificate: null },
    managed: { configured: true, certificate: null },
  },
  {
    name: 'Netlify',
    make: (url) => netlifyAdapter({ api: url }),
    site: { siteId: 'site_1', siteName: 'shop' },
    routes: (created) => [
      {
        method: 'GET',
        path: /^\/sites\/site_1$/,
        body: { name: 'shop', custom_domain: 'www.shop.id', domain_aliases: ['shop.example.com'] },
      },
      { method: 'GET', path: /^\/sites\/site_1\/ssl$/, body: { state: 'issued', domains: ['shop.example.com'] } },
      { method: 'GET', path: /^\/dns_zones$/, body: [{ id: 'zone_1', name: 'example.com' }] },
      {
        method: 'GET',
        path: /^\/dns_zones\/zone_1\/dns_records$/,
        body: [{ hostname: 'shop.example.com', type: 'NETLIFY', value: 'shop.netlify.app' }],
      },
      { method: 'PATCH', path: /^\/sites\/site_1$/, body: {} },
      {
        method: 'POST',
        path: /^\/dns_zones\/zone_1\/dns_records$/,
        body: { id: 'rec_1' },
        effect: () => created.push('example.com'),
      },
    ],
    records: {
      'www.shop.id': [{ type: 'CNAME', host: 'www.shop.id', name: 'www', value: 'shop.netlify.app' }],
      'shop.example.com': [{ type: 'CNAME', host: 'shop.example.com', name: 'shop', value: 'shop.netlify.app' }],
    },
    external: { configured: null, certificate: false },
    managed: { configured: true, certificate: true },
  },
]

describe.each(domainContracts)('$name domains', (contract) => {
  const setup = async () => {
    const created: string[] = []
    const server = await fake(contract.routes(created))
    return { server, created, domains: contract.make(server.url).capabilities.domains! }
  }

  it('lists custom domains with the records their DNS needs, in the zone’s own names', async () => {
    const { domains } = await setup()
    const listed = await domains.list(auth, contract.site)
    expect(listed.map((domain) => domain.name)).toEqual(['www.shop.id', 'shop.example.com'])
    for (const domain of listed) expect(domain.records).toEqual(contract.records[domain.name])
    expect(listed[0]).toMatchObject({ ...contract.external, managedDns: false, zone: 'shop.id' })
    expect(listed[1]).toMatchObject({ ...contract.managed, managedDns: true, zone: 'example.com' })
  })

  it('adds a domain and creates records only through the platform’s DNS', async () => {
    const { domains, server, created } = await setup()
    await domains.add(auth, contract.site, 'shop.example.org')
    expect(server.requests.some((line) => /^(POST|PATCH) /.test(line))).toBe(true)
    const managed = (await domains.list(auth, contract.site))[1]!
    await domains.createRecords(auth, contract.site, managed)
    expect(created).toEqual(['example.com'])
    expect(server.requests.join('\n')).not.toContain('tok_123')
  })
})

describe('domain state the platform does not report', () => {
  const probes = (resolves: boolean, https: boolean) => ({
    resolves: vi.fn(async () => resolves),
    https: vi.fn(async () => https),
  })
  const service = (adapter: HostingAdapter, checks: ReturnType<typeof probes>, siteId = 'site_1') =>
    new DeployService(
      {
        getState: <T>() =>
          ({
            platform: adapter.id,
            siteId,
            siteName: 'shop',
            repository: 'ana/shop',
            productionBranch: 'main',
            accountId: 'u1',
            scope: null,
          }) as T,
        setState: () => {},
        stackTarget: () => null,
        githubToken: async () => 'gh_123',
        githubRepository: async () => repository,
      },
      { auth: async () => ({ auth, accountId: 'u1', defaultScope: null }) } as never,
      () => adapter,
      checks,
    )

  it('checks public DNS, then HTTPS only once the DNS points at the platform', async () => {
    const server = await fake(domainContracts[1]!.routes([]))
    const adapter = netlifyAdapter({ api: server.url })
    const pointing = probes(true, true)
    const [external] = await service(adapter, pointing).domains('project')
    expect(external).toMatchObject({ name: 'www.shop.id', configured: true, certificate: false })
    // Netlify reports the certificate itself, so only the DNS was looked up.
    expect(pointing.resolves).toHaveBeenCalledWith(domainContracts[1]!.records['www.shop.id']![0])
    expect(pointing.https).not.toHaveBeenCalled()

    const vercel = await fake(domainContracts[0]!.routes([]))
    const unchecked = probes(false, true)
    const listed = await service(vercelAdapter({ api: vercel.url }), unchecked, 'prj_1').domains('project')
    expect(listed.map((domain) => [domain.name, domain.configured, domain.certificate])).toEqual([
      ['www.shop.id', false, false],
      ['shop.example.com', true, true],
    ])
    expect(unchecked.https).toHaveBeenCalledTimes(1)
    expect(unchecked.https).toHaveBeenCalledWith('shop.example.com')
  })

  it('refuses a name that is not a domain, and Create records outside the platform’s DNS', async () => {
    const server = await fake(domainContracts[1]!.routes([]))
    const deploys = service(netlifyAdapter({ api: server.url }), probes(false, false))
    await expect(deploys.addDomain('project', 'not a domain')).rejects.toThrow('domain name')
    await expect(deploys.createRecords('project', 'www.shop.id')).rejects.toThrow('does not use Netlify DNS')
    expect(server.requests.filter((line) => !line.startsWith('GET'))).toEqual([])
  })

  it('reports a domain the platform already lists instead of failing when adding it again', async () => {
    const server = await fake([
      { method: 'PATCH', path: /^\/sites\/site_1$/, drop: true },
      ...domainContracts[1]!.routes([]),
    ])
    const added = await service(netlifyAdapter({ api: server.url }), probes(false, false)).addDomain(
      'project',
      'https://WWW.shop.id/',
    )
    expect(added.name).toBe('www.shop.id')
  })
})

describe('pull request previews', () => {
  it('finds the newest preview of a branch, never a production deployment of the same branch', async () => {
    const listed = [
      { id: 'prod', state: 'ready', url: 'https://shop.app', production: true, ref: 'fix' },
      { id: 'new', state: 'building', url: null, production: false, ref: 'fix' },
      { id: 'old', state: 'ready', url: 'https://old.app', production: false, ref: 'fix' },
      { id: 'other', state: 'ready', url: 'https://other.app', production: false, ref: 'main' },
    ]
    const listDeployments = vi.fn(async () => listed)
    const service = new DeployService(
      {
        getState: <T>() =>
          ({
            platform: 'vercel',
            siteId: 's',
            siteName: 'shop',
            repository: 'ana/shop',
            productionBranch: 'main',
            accountId: 'u1',
            scope: null,
          }) as T,
        setState: () => {},
        stackTarget: () => null,
        githubToken: async () => 'gh_123',
        githubRepository: async () => {
          throw new Error('unused')
        },
      },
      { auth: async () => ({ auth: { token: 't' }, accountId: 'u1', defaultScope: null }) } as never,
      () => ({ listDeployments }) as never,
    )
    expect((await service.preview('project', 'fix'))?.id).toBe('new')
    expect(await service.preview('project', 'nothing')).toBeNull()
  })
})

describe('Own server hosting adapter', () => {
  const sha = (n: number) => String(n).repeat(40)
  const connection = {
    host: '203.0.113.10',
    port: 22,
    user: 'deploy',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----\n',
    publicKey: null,
    knownHosts: '203.0.113.10 ssh-ed25519 AAAA',
  }
  const serverAuth = { token: JSON.stringify(connection), github: async () => 'gh_123' }
  const site = { siteId: 'ana/shop', siteName: 'shop.example.com' }
  const run = (id: number, extra: object) => ({
    id,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: sha(id),
    display_title: `Deploy ${sha(id)}`,
    created_at: new Date(now - id * 1000).toISOString(),
    path: '.github/workflows/deploy.yml',
    head_commit: { message: `Change ${id}\n\nbody` },
    ...extra,
  })

  /** A fake server reached through the fake ssh runner: its files, and every command and input it received. */
  const fakeServer = () => {
    const env = new Map<string, string>([['DATABASE_URL', 'postgres://old']])
    let domains = ['shop.example.com']
    const received: { command: string; input: string }[] = []
    const ssh: SshRunner = async (target, command, input) => {
      expect(target.knownHosts).toBe(connection.knownHosts)
      received.push({ command, input })
      const values = (command.split("' ramu")[1] ?? '')
        .split(' ')
        .filter(Boolean)
        .map((value) => Buffer.from(value.slice(1), 'base64').toString())
      let stdout = ''
      if (command.includes('id -un')) stdout = 'deploy\n'
      else if (command.includes('printf "port=')) stdout = `port=3000\ndomains=${domains.join(' ')} \n`
      else if (command.includes('docker logs')) stdout = 'listening on 3000\nGET / 200\n'
      else if (command.includes('sed -n')) stdout = [...env.keys()].join('\n')
      else if (command.includes('awk -F='))
        for (const line of input.trim().split('\n')) env.set(line.split('=')[0]!, line.slice(line.indexOf('=') + 1))
      else if (command.includes('reverse_proxy')) domains = values[2]!.split(' ')
      return { code: 0, stdout, stderr: '', knownHosts: connection.knownHosts }
    }
    return { ssh, env, received, domains: () => domains }
  }

  const githubRoutes = (runs: unknown[], dispatched: { body: string | null }[]): Route[] => [
    {
      method: 'GET',
      path: /^\/repos\/ana\/shop\/actions\/workflows\/deploy\.yml\/runs\?per_page=/,
      body: { workflow_runs: runs },
    },
    {
      method: 'GET',
      path: /^\/repos\/ana\/shop\/actions\/runs\/1$/,
      body: runs.find((entry) => (entry as { id: number }).id === 1),
    },
    {
      method: 'GET',
      path: /^\/repos\/ana\/shop\/actions\/runs\/2$/,
      body: runs.find((entry) => (entry as { id: number }).id === 2),
    },
    {
      method: 'GET',
      path: /^\/repos\/ana\/shop\/actions\/runs\/9$/,
      body: run(9, { status: 'queued', conclusion: null }),
    },
    {
      method: 'GET',
      path: /^\/repos\/ana\/shop\/actions\/runs\/7$/,
      body: run(7, { path: '.github/workflows/ci.yml' }),
    },
    { method: 'GET', path: /^\/repos\/ana\/shop\/actions\/runs\/\d+\/jobs$/, body: { jobs: [{ id: 55 }] } },
    {
      method: 'POST',
      path: /^\/repos\/ana\/shop\/actions\/workflows\/deploy\.yml\/dispatches$/,
      body: { workflow_run_id: 9 },
      effect: () => dispatched.push({ body: null }),
    },
  ]

  const setup = async (runs: unknown[] = [run(1, {}), run(2, {}), run(3, { conclusion: 'skipped' })]) => {
    const dispatched: { body: string | null }[] = []
    const github = await fake(githubRoutes(runs, dispatched))
    const box = fakeServer()
    // The job log is a redirect to a short-lived file, fetched without the token.
    const logs = createServer((req, res) => {
      if (req.url === '/repos/ana/shop/actions/jobs/55/logs') {
        expect(req.headers.authorization).toBe('Bearer gh_123')
        return void res.writeHead(302, { Location: `${github.url}/blob/55` }).end()
      }
      expect(req.headers.authorization).toBeUndefined()
      res
        .writeHead(200)
        .end('2026-11-07T10:00:00.0000000Z Building\n2026-11-07T10:00:01.0000000Z Running ghcr.io/ana/shop\n')
    })
    servers.push(logs)
    await new Promise<void>((resolve) => logs.listen(0, '127.0.0.1', resolve))
    const port = (logs.address() as AddressInfo).port
    // The job log and its file are served apart from the recorded JSON replies.
    const fetcher: typeof fetch = (input, init) => {
      const url = String(input)
      return fetch(/\/actions\/jobs\/|\/blob\//.test(url) ? url.replace(/:\d+\//, `:${port}/`) : url, init)
    }
    const adapter = serverAdapter({
      ssh: box.ssh,
      api: github.url,
      fetch: fetcher,
      address: async () => '203.0.113.10',
      pollMs: 1,
    })
    return { adapter, github, box, dispatched }
  }

  it('answers every required read from the deploy job’s runs, the pinned key and the server', async () => {
    const { adapter, box, github } = await setup()
    expect(await adapter.account(serverAuth)).toMatchObject({
      id: 'deploy@203.0.113.10:22',
      name: 'deploy@203.0.113.10',
    })
    const deployments = await adapter.listDeployments(serverAuth, site, 10)
    // A run skipped because CI failed deployed nothing, so it is not listed.
    expect(deployments.map((entry) => entry.id)).toEqual(['1', '2'])
    expect(deployments[0]).toMatchObject({
      state: 'ready',
      production: true,
      ref: 'main',
      commit: sha(1),
      message: 'Change 1',
      url: null,
    })
    expect(await adapter.deploymentStatus(serverAuth, site, '1')).toMatchObject({ id: '1', state: 'ready' })
    expect(await adapter.productionUrl(serverAuth, site)).toBe('https://shop.example.com')
    // The live deploy's log ends with the container's own output; an older one has only its job log.
    const live = await adapter.deploymentLogs(serverAuth, site, '1', 5)
    expect(live).toBe('Building\nRunning ghcr.io/ana/shop\n\nlistening on 3000\nGET / 200')
    expect(await adapter.deploymentLogs(serverAuth, site, '2', 5)).toBe('Building\nRunning ghcr.io/ana/shop')
    expect(box.received.filter((call) => call.command.includes('docker logs'))).toHaveLength(1)
    // Only the GitHub token, and only in a header.
    expect(github.requests.join('\n')).not.toContain('gh_123')
  })

  it('declares only what it implements: deploys and rollbacks through the job, variables and domains on the server', async () => {
    const { adapter } = await setup()
    expect(capabilityNames(adapter)).toEqual(['deployProduction', 'rollback', 'domains'])
    expect(adapter.capabilities.environment?.environments).toEqual(['production'])
  })

  it('deploys by dispatching the job, and rolls back by dispatching it with the earlier commit', async () => {
    const { adapter, github } = await setup()
    const started = await adapter.capabilities.deployProduction!(
      serverAuth,
      { ...site, repository: 'ana/shop' },
      'main',
    )
    expect(started).toMatchObject({ id: '9', state: 'queued', production: true })
    await adapter.capabilities.rollback!(serverAuth, site, '2')
    expect(github.requests.filter((line) => line.startsWith('POST'))).toHaveLength(2)
    // Only runs of the deploy job can be put back.
    await expect(adapter.capabilities.rollback!(serverAuth, site, '7')).rejects.toMatchObject({ kind: 'not-found' })
    await expect(adapter.deploymentStatus(serverAuth, site, '1/../../x')).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('says to merge the deploy job first when GitHub has none', async () => {
    const github = await fake([{ method: 'POST', path: /dispatches$/, status: 404, body: {} }])
    const adapter = serverAdapter({ ssh: fakeServer().ssh, api: github.url })
    await expect(
      adapter.capabilities.deployProduction!(serverAuth, { ...site, repository: 'ana/shop' }, 'main'),
    ).rejects.toThrow(/Merge the pull request that adds the deploy job first/)
  })

  it('keeps variables on the server, sending values only on standard input', async () => {
    const { adapter, box } = await setup()
    const environment = adapter.capabilities.environment!
    expect(await environment.list(serverAuth, site)).toEqual({ production: ['DATABASE_URL'] })
    await environment.set(serverAuth, site, 'production', { API_KEY: 'sk_live_secret', DATABASE_URL: 'postgres://new' })
    const write = box.received.at(-1)!
    expect(write.command).not.toContain('sk_live_secret')
    expect(write.command).not.toContain(Buffer.from('sk_live_secret').toString('base64'))
    expect(write.input).toBe('API_KEY=sk_live_secret\nDATABASE_URL=postgres://new\n')
    expect(box.env.get('DATABASE_URL')).toBe('postgres://new')
    await expect(environment.set(serverAuth, site, 'production', { A: 'one\ntwo' })).rejects.toThrow(/several lines/)
    await expect(environment.set(serverAuth, site, 'production', { 'A B': 'x' })).rejects.toThrow(/not a variable name/)
  })

  it('lists the domains Caddy serves with the A record each needs, and adds one to the Caddy site', async () => {
    const { adapter, box } = await setup()
    const domains = adapter.capabilities.domains!
    expect(await domains.list(serverAuth, site)).toEqual([
      {
        name: 'shop.example.com',
        records: [{ type: 'A', host: 'shop.example.com', name: 'shop', value: '203.0.113.10' }],
        configured: null,
        certificate: null,
        managedDns: false,
        zone: 'example.com',
      },
    ])
    await domains.add(serverAuth, site, 'www.example.com')
    expect(box.domains()).toEqual(['shop.example.com', 'www.example.com'])
    await expect(domains.createRecords(serverAuth, site, (await domains.list(serverAuth, site))[0]!)).rejects.toThrow(
      /domain provider/,
    )
  })

  it('reaches only the bound repository with a token, and fails plainly without one', async () => {
    const { adapter } = await setup()
    await expect(adapter.listDeployments({ token: serverAuth.token }, site, 5)).rejects.toMatchObject({
      kind: 'not-found',
    })
  })
})

describe('Railway specifics', () => {
  const site = { siteId: 'prj_1:env_prod:svc_1', siteName: 'shop' }
  const graphql = (operation: string, data: unknown, extra: Partial<Route> = {}): Route => ({
    method: 'POST',
    path: /^\/graphql$/,
    operation,
    body: { data },
    ...extra,
  })

  it('maps GraphQL errors answered beside a 200 to the shared kinds, without passing their text on', async () => {
    for (const [message, kind] of [
      ['Not Authorized', 'missing-permission'],
      ['Project not found', 'not-found'],
      ['Usage limit exceeded for this plan', 'plan-limit'],
      ['Something else broke (tok_123)', null],
    ] as const) {
      const server = await fake([{ method: 'POST', path: /./, body: { data: null, errors: [{ message }] } }])
      const failure = await railwayAdapter({ api: `${server.url}/graphql` })
        .listDeployments(auth, site, 5)
        .catch((error: unknown) => error)
      expect((failure as DeployError).kind).toBe(kind)
      expect((failure as Error).message).not.toContain('tok_123')
    }
  })

  it('names a workspace token by its workspace, since only account tokens can read `me`', async () => {
    const server = await fake([
      { method: 'POST', path: /./, operation: 'Me', body: { data: null, errors: [{ message: 'Not Authorized' }] } },
      graphql('Token', { apiToken: { workspaces: [{ id: 'ws_1', name: 'Ana’s team' }] } }),
    ])
    expect(await railwayAdapter({ api: `${server.url}/graphql` }).account(auth)).toEqual({
      id: 'ws_1',
      name: 'Ana’s team',
      defaultScope: 'ws_1',
      broadScope: null,
      expiresAt: null,
    })
  })

  it('refuses a deployment of another service and a link Ramu did not make', async () => {
    const server = await fake([
      graphql('Deployment', { deployment: { id: 'dep_9', status: 'SUCCESS', serviceId: 'svc_other' } }),
    ])
    const adapter = railwayAdapter({ api: `${server.url}/graphql` })
    await expect(adapter.capabilities.rollback!(auth, site, 'dep_9')).rejects.toMatchObject({ kind: 'not-found' })
    await expect(adapter.listDeployments(auth, { siteId: 'prj_1', siteName: 'shop' }, 5)).rejects.toMatchObject({
      kind: 'not-found',
    })
    expect(server.requests.filter(writes)).toEqual([])
  })

  it('lists variable names only and writes production’s through one upsert', async () => {
    const sent: Record<string, unknown>[] = []
    const server = await fake([
      graphql('Variables', null, {
        answer: (variables) => {
          sent.push(variables)
          return { data: { variables: { DATABASE_URL: 'postgres://secret', RAILWAY_PUBLIC_DOMAIN: 'x' } } }
        },
      }),
    ])
    const environment = railwayAdapter({ api: `${server.url}/graphql` }).capabilities.environment!
    expect(environment.environments).toEqual(['production'])
    expect(await environment.list(auth, site)).toEqual({ production: ['DATABASE_URL', 'RAILWAY_PUBLIC_DOMAIN'] })
    await environment.set(auth, site, 'production', { API_KEY: 'sk_1' })
    expect(sent.at(-1)).toEqual({
      input: { projectId: 'prj_1', environmentId: 'env_prod', serviceId: 'svc_1', variables: { API_KEY: 'sk_1' } },
    })
  })

  it('lists custom domains with the records Railway asks for, and never creates DNS records', async () => {
    const server = await fake([
      graphql('Domains', {
        domains: {
          serviceDomains: [{ domain: 'shop-production.up.railway.app' }],
          customDomains: [
            {
              domain: 'www.shop.id',
              status: {
                certificateStatus: 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
                dnsRecords: [
                  {
                    hostlabel: 'www',
                    fqdn: 'www.shop.id',
                    recordType: 'DNS_RECORD_TYPE_CNAME',
                    requiredValue: 'abc.up.railway.app',
                    status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
                    zone: 'shop.id',
                  },
                ],
              },
            },
            {
              domain: 'shop.example.com',
              status: {
                certificateStatus: 'CERTIFICATE_STATUS_TYPE_VALID',
                dnsRecords: [
                  {
                    hostlabel: 'shop',
                    fqdn: 'shop.example.com',
                    recordType: 'DNS_RECORD_TYPE_CNAME',
                    requiredValue: 'def.up.railway.app',
                    status: 'DNS_RECORD_STATUS_PROPAGATED',
                    zone: 'example.com',
                  },
                ],
              },
            },
          ],
        },
      }),
      graphql('CustomDomainCreate', { customDomainCreate: { id: 'cd_1' } }),
    ])
    const domains = railwayAdapter({ api: `${server.url}/graphql` }).capabilities.domains!
    expect(await domains.list(auth, site)).toEqual([
      {
        name: 'www.shop.id',
        records: [{ type: 'CNAME', host: 'www.shop.id', name: 'www', value: 'abc.up.railway.app' }],
        configured: false,
        certificate: false,
        managedDns: false,
        zone: 'shop.id',
      },
      {
        name: 'shop.example.com',
        records: [{ type: 'CNAME', host: 'shop.example.com', name: 'shop', value: 'def.up.railway.app' }],
        configured: true,
        certificate: true,
        managedDns: false,
        zone: 'example.com',
      },
    ])
    await domains.add(auth, site, 'shop.example.org')
    expect(server.requests.at(-1)).toMatch(/mutation CustomDomainCreate$/)
    await expect(domains.createRecords(auth, site, (await domains.list(auth, site))[0]!)).rejects.toThrow(
      /domain provider/,
    )
  })
})

describe('Fly.io hosting adapter', () => {
  const sha = (n: number) => String(n).repeat(40)
  const site = { siteId: 'ana/shop', siteName: 'shop-app' }
  const user = { token: 'fo1_user' }
  const run = (id: number, extra: object = {}) => ({
    id,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: sha(id),
    display_title: `Deploy ${sha(id)}`,
    created_at: new Date(now - id * 1000).toISOString(),
    path: '.github/workflows/fly-deploy.yml',
    head_commit: { message: `Change ${id}` },
    ...extra,
  })
  const graphql = (operation: string, data: unknown, extra: Partial<Route> = {}): Route => ({
    method: 'POST',
    path: /^\/graphql$/,
    operation,
    body: { data },
    ...extra,
  })
  const setup = async (routes: Route[] = []) => {
    const headers: string[] = []
    // Routes a test passes come first, so they answer before the defaults.
    const server = await fake([
      ...routes,
      graphql('Viewer', {
        viewer: { __typename: 'User', id: 'u1', email: 'ana@example.com', name: 'Ana' },
        organizations: {
          nodes: [
            { id: 'org_team', slug: 'team', type: 'SHARED' },
            { id: 'org_1', slug: 'personal', type: 'PERSONAL' },
          ],
        },
      }),
      {
        method: 'GET',
        path: /^\/gh\/repos\/ana\/shop\/actions\/workflows\/fly-deploy\.yml\/runs\?per_page=/,
        body: { workflow_runs: [run(1), run(2), run(3, { conclusion: 'skipped' })] },
      },
      { method: 'GET', path: /^\/gh\/repos\/ana\/shop\/actions\/runs\/2$/, body: run(2) },
      {
        method: 'GET',
        path: /^\/gh\/repos\/ana\/shop\/actions\/runs\/9$/,
        body: run(9, { status: 'queued', conclusion: null }),
      },
      {
        method: 'GET',
        path: /^\/gh\/repos\/ana\/shop\/actions\/runs\/7$/,
        body: run(7, { path: '.github/workflows/deploy.yml' }),
      },
      {
        method: 'POST',
        path: /^\/gh\/repos\/ana\/shop\/actions\/workflows\/fly-deploy\.yml\/dispatches$/,
        body: { workflow_run_id: 9 },
      },
      {
        method: 'GET',
        path: /^\/v1\/apps\/shop-app\/secrets$/,
        body: { secrets: [{ name: 'DATABASE_URL', digest: 'x' }] },
      },
      { method: 'POST', path: /^\/v1\/apps\/shop-app\/secrets$/, body: { secrets: [], version: 2 } },
      {
        method: 'GET',
        path: /^\/v1\/apps\/shop-app\/certificates$/,
        body: {
          certificates: [
            { hostname: 'shop-app.fly.dev', configured: true },
            { hostname: 'www.shop.id', configured: false },
            { hostname: 'shop.id', configured: true },
          ],
        },
      },
      {
        method: 'GET',
        path: /^\/v1\/apps\/shop-app\/certificates\/www\.shop\.id$/,
        body: {
          hostname: 'www.shop.id',
          configured: false,
          dns_requirements: { cname: 'shop-app.fly.dev.', a: ['66.241.1.1'] },
        },
      },
      {
        method: 'GET',
        path: /^\/v1\/apps\/shop-app\/certificates\/shop\.id$/,
        body: { hostname: 'shop.id', configured: true, dns_requirements: { a: ['66.241.1.1'], aaaa: ['2a09::1'] } },
      },
      { method: 'POST', path: /^\/v1\/apps\/shop-app\/certificates\/acme$/, status: 201, body: {} },
    ])
    const fetcher: typeof fetch = (input, init) => {
      headers.push(String(new Headers(init?.headers).get('authorization')))
      return fetch(input, init)
    }
    const options = {
      graphql: `${server.url}/graphql`,
      machines: `${server.url}/v1`,
      github: `${server.url}/gh`,
      fetch: fetcher,
    }
    return { server, headers, adapter: flyAdapter({ ...options, pollMs: 1 }), api: flyApi(options) }
  }
  const withGithub = { ...user, github: async () => 'gh_123' }

  it('sends user tokens and macaroons with the scheme each Fly API takes', () => {
    expect(flyAuthorization('fo1_user', 'graphql')).toBe('Bearer fo1_user')
    expect(flyAuthorization('FlyV1 fm2_a,fm2_b', 'machines')).toBe('FlyV1 fm2_a,fm2_b')
    expect(flyAuthorization('fo1_user,fm2_a', 'graphql')).toBe('FlyV1 fm2_a,fo1_user')
    expect(flyAuthorization('fo1_user,fm2_a', 'machines')).toBe('FlyV1 fm2_a')
  })

  it('names a user sign-in as broad and defaults new apps to the personal organization', async () => {
    const { adapter } = await setup()
    expect(await adapter.account(user)).toMatchObject({ id: 'u1', name: 'Ana', defaultScope: 'personal' })
    expect((await adapter.account(user)).broadScope).toMatch(/organization token/)
    const macaroon = await setup([
      graphql('Viewer', {
        viewer: { __typename: 'Macaroon', id: null, email: 'ana@example.com', name: null },
        organizations: { nodes: [{ id: 'org_team', slug: 'team', type: 'SHARED' }] },
      }),
    ])
    expect(await macaroon.adapter.account({ token: 'FlyV1 fm2_org' })).toMatchObject({
      id: 'org:team',
      defaultScope: 'team',
      broadScope: null,
    })
  })

  it('declares only what it implements, reading deployments from the deploy job and dispatching it', async () => {
    const { adapter, server } = await setup()
    expect(capabilityNames(adapter)).toEqual(['deployProduction', 'rollback', 'domains'])
    expect(adapter.capabilities.environment?.environments).toEqual(['production'])
    const listed = await adapter.listDeployments(withGithub, site, 10)
    expect(listed.map((entry) => entry.id)).toEqual(['1', '2'])
    expect(listed[0]).toMatchObject({
      state: 'ready',
      production: true,
      ref: 'main',
      commit: sha(1),
      message: 'Change 1',
    })
    expect(await adapter.productionUrl(withGithub, site)).toBe('https://shop-app.fly.dev')
    expect(
      await adapter.capabilities.deployProduction!(withGithub, { ...site, repository: 'ana/shop' }, 'main'),
    ).toMatchObject({
      id: '9',
      state: 'queued',
    })
    await adapter.capabilities.rollback!(withGithub, site, '2')
    await expect(adapter.capabilities.rollback!(withGithub, site, '7')).rejects.toMatchObject({ kind: 'not-found' })
    expect(server.requests.filter((line) => /dispatches$/.test(line))).toHaveLength(2)
    await expect(adapter.productionUrl(withGithub, { siteId: 'ana/shop', siteName: '../x' })).rejects.toMatchObject({
      kind: 'not-found',
    })
  })

  it('keeps variables as Fly secrets: names only when listing, values written in one call', async () => {
    const { adapter, server } = await setup()
    const environment = adapter.capabilities.environment!
    expect(await environment.list(user, site)).toEqual({ production: ['DATABASE_URL'] })
    await environment.set(user, site, 'production', { API_KEY: 'sk_1' })
    expect(server.requests.at(-1)).toBe('POST /v1/apps/shop-app/secrets')
    expect(server.requests.join('\n')).not.toContain('sk_1')
  })

  it('lists custom domains with the record each needs, adds one as a certificate, and leaves DNS to the person', async () => {
    const { adapter, server } = await setup()
    const domains = adapter.capabilities.domains!
    expect(await domains.list(user, site)).toEqual([
      {
        name: 'www.shop.id',
        records: [{ type: 'CNAME', host: 'www.shop.id', name: 'www', value: 'shop-app.fly.dev' }],
        configured: false,
        certificate: null,
        managedDns: false,
        zone: 'shop.id',
      },
      {
        name: 'shop.id',
        records: [{ type: 'A', host: 'shop.id', name: '@', value: '66.241.1.1' }],
        configured: true,
        certificate: null,
        managedDns: false,
        zone: 'shop.id',
      },
    ])
    await domains.add(user, site, 'app.shop.id')
    expect(server.requests.at(-1)).toBe('POST /v1/apps/shop-app/certificates/acme')
    await expect(domains.createRecords(user, site, (await domains.list(user, site))[0]!)).rejects.toThrow(
      /domain provider/,
    )
  })

  it('creates the app (with a suffix when the name is taken) and a deploy token limited to it', async () => {
    let taken = true
    const sent: Record<string, unknown>[] = []
    const { api, headers } = await setup([
      {
        method: 'POST',
        path: /^\/v1\/apps$/,
        status: 422,
        body: { error: 'taken' },
        effect: () => void (taken = false),
      },
      graphql('AppOrganization', { app: { organization: { id: 'org_1' } } }),
      graphql('DeployToken', null, {
        answer: (variables) => {
          sent.push(variables)
          return { data: { createLimitedAccessToken: { limitedAccessToken: { tokenHeader: 'FlyV1 fm2_deploy' } } } }
        },
      }),
    ])
    const created = await api
      .createApp({ token: 'FlyV1 fm2_org' }, 'shop-app', 'personal')
      .catch((error: unknown) => error)
    // The second name is tried after the first is refused as taken; the fake refuses both here.
    expect(taken).toBe(false)
    expect(created).toBeInstanceOf(DeployError)
    expect(await api.deployToken(user, 'shop-app')).toBe('FlyV1 fm2_deploy')
    expect(sent[0]).toMatchObject({
      input: { organizationId: 'org_1', profile: 'deploy', profileParams: { app_id: 'shop-app' } },
    })
    expect(headers).toContain('FlyV1 fm2_org')
  })

  it.each([
    [401, 'signed-out'],
    [403, 'missing-permission'],
    [404, 'not-found'],
  ])('maps %i from the Machines API to the shared failure kind', async (status, kind) => {
    const server = await fake([{ method: 'GET', path: /./, status, body: {} }])
    const failure = await flyAdapter({ machines: `${server.url}/v1` })
      .capabilities.environment!.list(user, site)
      .catch((error: unknown) => error)
    expect((failure as DeployError).kind).toBe(kind)
  })
})
