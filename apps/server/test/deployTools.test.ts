import { describe, expect, it, vi } from 'vitest'
import type { DomainStatus } from '@ramu/shared/types/deploy'
import { registerDeployTools } from '../src/workspace/deploy/tools'

type Handler = (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => Promise<unknown>

const managed: DomainStatus = {
  name: 'shop.example.com',
  records: [{ type: 'CNAME', host: 'shop.example.com', name: 'shop', value: 'cname.vercel-dns.com' }],
  configured: false,
  certificate: false,
  managedDns: true,
}

function setup(approve: boolean) {
  const tools = new Map<string, Handler>()
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => void tools.set(name, handler) }
  const deploys = {
    platformName: () => 'Vercel',
    domains: vi.fn(async () => [managed]),
    addDomain: vi.fn(async (_project: string, name: string) => ({ ...managed, name, managedDns: false })),
    createRecords: vi.fn(async () => managed),
    project: vi.fn(async () => ({
      binding: { siteName: 'shop', productionBranch: 'main' },
      productionUrl: 'https://shop.vercel.app',
      deployments: [],
    })),
    deploy: vi.fn(async (_project: string, _ref: string | null, production: boolean) => ({ id: 'd1', production })),
  }
  const watches = { domains: { watch: vi.fn() }, deploys: { follow: vi.fn() } }
  const asked: string[] = []
  const source = { id: 's1', parentId: null, cwd: '/tmp/shop', settings: { access: 'full' } }
  registerDeployTools(
    server as never,
    deploys as never,
    watches,
    async () => [],
    source as never,
    'p1',
    () => source as never,
    () => 'Shop',
    async (detail) => {
      asked.push(detail)
      return approve
    },
  )
  return { tools, deploys, watches, asked }
}

describe('domain tools', () => {
  it('always ask with a card naming the domain, and a refusal changes nothing', async () => {
    const { tools, deploys, asked } = setup(false)
    await expect(tools.get('deploy_domain_add')!({ domain: 'www.shop.id' }, {})).rejects.toThrow('declined')
    await expect(tools.get('deploy_domain_records')!({ domain: 'shop.example.com' }, {})).rejects.toThrow('declined')
    expect(asked[0]).toContain('Add the domain www.shop.id to Shop on Vercel')
    expect(asked[1]).toContain('a CNAME record named shop pointing to cname.vercel-dns.com')
    expect(deploys.addDomain).not.toHaveBeenCalled()
    expect(deploys.createRecords).not.toHaveBeenCalled()
  })

  it('adds the domain once approved and wakes this thread when it is live', async () => {
    const { tools, deploys, watches } = setup(true)
    await tools.get('deploy_domain_add')!({ domain: 'https://WWW.shop.id' }, {})
    expect(deploys.addDomain).toHaveBeenCalledWith('p1', 'www.shop.id')
    expect(watches.domains.watch).toHaveBeenCalledWith('p1', 'www.shop.id', 's1')
    await expect(tools.get('deploy_domain_add')!({ domain: 'localhost' }, {})).rejects.toThrow('domain name')
  })
})

describe('deploy tools', () => {
  it('follow a production deploy so this thread hears how it finished, and never deploy when refused', async () => {
    const refused = setup(false)
    await expect(refused.tools.get('deploy_production')!({}, {})).rejects.toThrow('declined')
    expect(refused.deploys.deploy).not.toHaveBeenCalled()
    expect(refused.watches.deploys.follow).not.toHaveBeenCalled()
    const { tools, watches } = setup(true)
    await tools.get('deploy_production')!({}, {})
    expect(watches.deploys.follow).toHaveBeenCalledWith('p1', { id: 'd1', production: true }, 's1')
  })
})
