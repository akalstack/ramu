import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { cloudflareProjectName, cloudflareWorkflow, workerName, workersWorkflow } from '@ramu/shared/cloudflareDeploy'
import { cloudflareAdapter, cloudflareBranchAlias, cloudflareWorkersAdapter } from '../src/workspace/deploy/cloudflare'

describe('the Cloudflare Pages deploy job', () => {
  it('deploys production after CI and a preview per pull request, with wrangler and the repository’s secrets', () => {
    const workflow = parse(
      cloudflareWorkflow({
        project: 'shop',
        defaultBranch: 'main',
        afterCi: true,
        build: { manager: 'npm', output: 'dist' },
      }),
    ) as {
      on: Record<string, unknown>
      jobs: { deploy: { steps: { uses?: string; run?: string; with?: Record<string, string> }[] } }
    }
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch', 'workflow_run'])
    const wrangler = workflow.jobs.deploy.steps.find((step) => step.uses === 'cloudflare/wrangler-action@v3')!
    expect(wrangler.with).toMatchObject({
      apiToken: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      accountId: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
    })
    expect(wrangler.with!.command).toContain('pages deploy dist --project-name=shop')
    expect(workflow.jobs.deploy.steps.some((step) => step.run === 'npm run build')).toBe(true)
    expect(cloudflareProjectName('Ana’s Shop!')).toBe('ana-s-shop')
  })
})

describe('the Cloudflare Pages adapter', () => {
  it('checks the token’s account, and gives runs production or branch preview addresses', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/user/tokens/verify'))
        return new Response(
          JSON.stringify({ success: true, result: { status: 'active', expires_on: '2027-01-01T00:00:00Z' } }),
        )
      if (url.endsWith('/accounts'))
        return new Response(JSON.stringify({ success: true, result: [{ id: 'acc1', name: 'Ana' }] }))
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 2,
              status: 'completed',
              conclusion: 'success',
              head_branch: 'Feature/Login',
              event: 'pull_request',
              head_sha: 'b'.repeat(40),
            },
            {
              id: 1,
              status: 'completed',
              conclusion: 'success',
              head_branch: 'main',
              event: 'workflow_run',
              head_sha: 'a'.repeat(40),
            },
          ],
        }),
      )
    }) as typeof fetch
    const adapter = cloudflareAdapter({ api: 'https://cf.test', github: 'https://gh.test', fetch: fetcher })
    expect(await adapter.account({ token: 'cf' })).toMatchObject({
      id: 'acc1',
      name: 'Ana',
      defaultScope: 'acc1',
      expiresAt: Date.parse('2027-01-01T00:00:00Z'),
    })
    const auth = { token: 'cf', github: async () => 'gh' }
    const deployments = await adapter.listDeployments(auth, { siteId: 'ana/shop', siteName: 'shop' }, 5)
    expect(deployments.map((entry) => [entry.production, entry.url])).toEqual([
      [false, 'https://feature-login.shop.pages.dev'],
      [true, 'https://shop.pages.dev'],
    ])
    expect(new URL(adapter.tokenPage).searchParams.get('permissionGroupKeys')).toBe('[{"key":"page","type":"edit"}]')
    expect(cloudflareBranchAlias('A/very-long-branch-name-that-goes-on')).toBe('a-very-long-branch-name-that')
    await expect(adapter.productionUrl(auth, { siteId: 'ana/shop', siteName: 'bad name' })).rejects.toThrow(
      'not one Ramu set up',
    )
  })

  it('adds a custom domain to the Pages project and gives the CNAME it needs', async () => {
    const calls: string[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)} ${init?.body ?? ''}`)
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            { name: 'www.shop.com', status: 'pending' },
            { name: 'shop.com', status: 'active' },
          ],
        }),
      )
    }) as typeof fetch
    const domains = cloudflareAdapter({ api: 'https://cf.test', fetch: fetcher }).capabilities.domains!
    const auth = { token: 'cf', scope: 'acc1' }
    const site = { siteId: 'ana/shop', siteName: 'shop' }
    await domains.add(auth, site, 'www.shop.com')
    expect(calls[0]).toBe('POST https://cf.test/accounts/acc1/pages/projects/shop/domains {"name":"www.shop.com"}')
    expect(await domains.list(auth, site)).toEqual([
      {
        name: 'www.shop.com',
        records: [{ type: 'CNAME', host: 'www.shop.com', name: 'www', value: 'shop.pages.dev' }],
        configured: false,
        certificate: false,
        managedDns: false,
        zone: 'shop.com',
      },
      {
        name: 'shop.com',
        records: [{ type: 'CNAME', host: 'shop.com', name: '@', value: 'shop.pages.dev' }],
        configured: true,
        certificate: true,
        managedDns: false,
        zone: 'shop.com',
      },
    ])
  })
})

describe('Cloudflare Workers', () => {
  it('runs wrangler deploy after installing with the lockfile’s manager, and finds the Worker’s name and address', async () => {
    const workflow = parse(workersWorkflow({ defaultBranch: 'main', afterCi: false, manager: 'pnpm' })) as {
      on: Record<string, unknown>
      jobs: { deploy: { steps: { uses?: string; run?: string; with?: Record<string, string> }[] } }
    }
    expect(workflow.on.push).toEqual({ branches: ['main'] })
    expect(workflow.jobs.deploy.steps.some((step) => step.run?.includes('pnpm install --frozen-lockfile'))).toBe(true)
    expect(workflow.jobs.deploy.steps.at(-1)?.with?.command).toBe('deploy')
    expect(workerName('name = "api-worker"\nmain = "src/index.ts"')).toBe('api-worker')
    expect(workerName('{\n  // edge\n  "name": "edge"\n}')).toBe('edge')
    expect(workerName('main = "src/index.ts"')).toBeNull()
    const fetcher = (async () =>
      new Response(JSON.stringify({ success: true, result: { subdomain: 'ana' } }))) as unknown as typeof fetch
    const workers = cloudflareWorkersAdapter({ api: 'https://cf.test', fetch: fetcher })
    expect(
      await workers.productionUrl({ token: 'cf', scope: 'acc1' }, { siteId: 'ana/api', siteName: 'api-worker' }),
    ).toBe('https://api-worker.ana.workers.dev')
  })

  it('reports this month’s requests and errors from the analytics API, and refuses plainly without analytics access', async () => {
    let sent: { query: string; variables: Record<string, string> } | undefined
    let answer: unknown = {
      data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 1200, errors: 3 } }] }] } },
    }
    const fetcher = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://cf.test/graphql')
      sent = JSON.parse(String(init.body)) as typeof sent
      return new Response(JSON.stringify(answer))
    }) as unknown as typeof fetch
    const workers = cloudflareWorkersAdapter({ api: 'https://cf.test', fetch: fetcher })
    const auth = { token: 'cf', scope: 'acc1' }
    const site = { siteId: 'ana/api', siteName: 'api-worker' }
    const usage = await workers.capabilities.usage!(auth, site)
    expect(sent?.variables).toMatchObject({ account: 'acc1', script: 'api-worker' })
    expect(sent?.query).toContain('workersInvocationsAdaptive')
    expect(usage.figures).toEqual([
      { metric: 'service', service: 'Requests', used: 1200, unit: 'requests', limit: null },
      { metric: 'service', service: 'Errors', used: 3, unit: 'requests', limit: null },
    ])
    expect(usage.period?.end).toBeNull()
    answer = { data: null, errors: [{ message: 'not authorized for that account' }] }
    await expect(workers.capabilities.usage!(auth, site)).rejects.toThrow('Account Analytics read')
  })
})
