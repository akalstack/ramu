// The contract every hosting adapter passes: required reads, declared capabilities, a deploy whose reply is lost,
// and failures mapped to the shared kinds. Each adapter runs against a local fake server with recorded replies.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deployment, DeployBinding, DnsRecord, HostingCapability, UsageFigure } from '@ramu/shared/types/deploy'
import { capabilityNames, DeployError, type HostingAdapter, type HostingSite } from '../src/workspace/deploy/adapter'
import { netlifyAdapter } from '../src/workspace/deploy/netlify'
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
    capabilities: ['linkRepository', 'deployPreview', 'deployProduction', 'rollback', 'promote', 'domains', 'usage'],
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
      { method: 'PATCH', path: /^\/v9\/projects\/prj_1$/, body: {} },
      { method: 'POST', path: /^\/v10\/projects\/prj_1\/promote\/dpl_2$/, body: {} },
    ],
  },
  {
    name: 'Netlify',
    platform: 'netlify',
    make: (url) => netlifyAdapter({ api: url, github: `${url}/gh` }),
    site: { siteId: 'site_1', siteName: 'shop' },
    capabilities: ['linkRepository', 'deployProduction', 'rollback', 'promote', 'domains', 'usage'],
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
      { method: 'GET', path: /^\/sites\/site_1$/, body: { id: 'site_1', published_deploy: { id: 'd1' } } },
      { method: 'POST', path: /^\/deploys\/d1\/lock$/, body: {} },
      { method: 'POST', path: /^\/sites\/site_1\/deploys\/d2\/restore$/, body: {} },
      { method: 'POST', path: /^\/deploys\/d2\/lock$/, body: {} },
    ],
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
    if (adapter.capabilities.promote) {
      // Holding production keeps the live build until Ramu promotes the new one after its migrations.
      await adapter.capabilities.hold!(auth, site, true)
      await adapter.capabilities.promote(auth, site, contract.createdId)
      const held = server.requests.slice(-2).join('\n')
      expect(held).toContain(contract.createdId)
    }
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
