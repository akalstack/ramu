// The contract every hosting adapter passes: required reads, declared capabilities, a deploy whose reply is lost,
// and failures mapped to the shared kinds. Each adapter runs against a local fake server with recorded replies.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Deployment, DeployBinding, HostingCapability } from '@ramu/shared/types/deploy'
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
    const line = `${req.method} ${req.url}`
    state.requests.push(line)
    expect(req.headers.authorization).toMatch(/^Bearer \S+/)
    req.resume()
    req.on('end', () => {
      const route = state.routes.find((entry) => entry.method === req.method && entry.path.test(req.url ?? ''))
      if (!route) return void res.writeHead(500).end(`no recorded reply for ${line}`)
      route.effect?.()
      if (route.drop) return void req.socket.destroy()
      res.writeHead(route.status ?? 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(route.body ?? {}))
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
  make(url: string): HostingAdapter
  site: HostingSite
  capabilities: HostingCapability[]
  routes(list: unknown[], created: unknown): Route[]
  first: unknown
  created: unknown
  createdId: string
  productionUrl: string
  logTail: string
}

const now = Date.now()
const contracts: Contract[] = [
  {
    name: 'Vercel',
    make: (url) => vercelAdapter({ api: url }),
    site: { siteId: 'prj_1', siteName: 'shop' },
    capabilities: ['linkRepository', 'deployPreview', 'deployProduction', 'rollback'],
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
    productionUrl: 'https://shop.example.com',
    logTail: 'Error: build failed',
    routes: (list, created) => [
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
    make: (url) => netlifyAdapter({ api: url, github: `${url}/gh` }),
    site: { siteId: 'site_1', siteName: 'shop' },
    capabilities: ['linkRepository', 'deployProduction', 'rollback'],
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
    productionUrl: 'https://shop.netlify.app',
    logTail: 'Failed: exit 2',
    routes: (list, created) => [
      { method: 'GET', path: /^\/user$/, body: { id: 'u1', full_name: 'Ana' } },
      { method: 'GET', path: /^\/sites\/site_1\/deploys\?per_page=/, body: list },
      { method: 'GET', path: /^\/sites\/site_1\/deploys\/d1$/, body: list.at(-1) },
      { method: 'GET', path: /^\/sites\/site_1\/deploys\/d2$/, body: created },
      { method: 'GET', path: /^\/builds\/b1\/log$/, body: [{ message: 'Building' }, { message: 'Failed: exit 2' }] },
      { method: 'GET', path: /^\/sites\/site_1$/, body: { ssl_url: 'https://shop.netlify.app' } },
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
]

const auth = { token: 'tok_123' }
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
    await adapter.capabilities.rollback!(auth, site, contract.name === 'Vercel' ? 'dpl_1' : 'd1')
    // Tokens go only in the Authorization header, never in a URL.
    expect(server.requests.join('\n')).not.toContain('tok_123')
  })

  it('reads the list again when a deploy reply is lost, and never deploys twice', async () => {
    const { adapter, server } = await setup()
    server.routes.find((route) => route.id === 'deploy')!.drop = true
    const binding: DeployBinding = {
      platform: contract.name === 'Vercel' ? 'vercel' : 'netlify',
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
    expect(server.requests.filter((line) => line.startsWith('POST'))).toHaveLength(1)
    // The answer came from reading the deployments again after the lost reply.
    expect(server.requests.at(-1)).toMatch(/deployments\?projectId|deploys\?per_page/)
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
    expect(server.requests.filter((line) => line.startsWith('POST'))).toHaveLength(0)
  })

  it.each([
    [401, '{}', 'signed-out'],
    [403, '{"error":{"code":"forbidden"}}', 'missing-permission'],
    [402, '{}', 'plan-limit'],
    [400, '{"error":{"message":"You have exceeded the deployment limit"}}', 'plan-limit'],
    [404, '{}', 'not-found'],
    [500, '{"secret":"echoed tok_123"}', null],
  ])('maps %i to the shared failure kind', async (status, body, kind) => {
    const server = await fake([{ method: 'GET', path: /./, status, body: JSON.parse(body) }])
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
