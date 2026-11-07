// Cloudflare D1 as a resource adapter, against a local fake of Cloudflare's API: a production and a preview database,
// made once and reused, and offered only to a project deployed to Cloudflare Workers.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { d1Adapter } from '../src/workspace/deploy/d1'
import { ResourceService } from '../src/workspace/deploy/resources'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fake() {
  const databases: { uuid: string; name: string }[] = []
  const created: string[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      expect(req.headers.authorization).toBe('Bearer cf_token')
      const url = new URL(req.url ?? '/', 'http://fake')
      const send = (result: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result }))
      if (url.pathname === '/accounts') return send([{ id: 'acc1', name: 'Ana' }])
      if (url.pathname === '/accounts/acc1/d1/database' && req.method === 'GET')
        return send(databases.filter((entry) => entry.name === url.searchParams.get('name')))
      if (url.pathname === '/accounts/acc1/d1/database' && req.method === 'POST') {
        const made = { uuid: `uuid-${databases.length + 1}`, name: (JSON.parse(text) as { name: string }).name }
        databases.push(made)
        created.push(made.name)
        return send(made)
      }
      const one = /^\/accounts\/acc1\/d1\/database\/([\w-]+)$/.exec(url.pathname)
      const found = one && databases.find((entry) => entry.uuid === one[1])
      if (found) return send(found)
      res.writeHead(404).end('{"result":null}')
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, created }
}

const auth = { token: 'cf_token', scope: null }

describe('Cloudflare D1', () => {
  it('makes the production database and a preview one once, and names both for the binding', async () => {
    const { url, created } = await fake()
    const adapter = d1Adapter({ api: url })
    expect(await adapter.account(auth)).toMatchObject({ id: 'acc1', defaultScope: 'acc1' })
    const made = await adapter.provision(auth, { name: 'shop' }, 'default')
    // A Worker reaches D1 through its binding, so nothing is set as a variable.
    expect(made).toEqual({ id: 'uuid-1', name: 'shop', variables: {} })
    expect(await adapter.branch!(auth, made.id, 'preview')).toEqual({})
    expect(await adapter.databases(auth, made.id)).toEqual({ name: 'shop', id: 'uuid-1', previewId: 'uuid-2' })
    // Provisioning again reuses the databases already made.
    await adapter.provision(auth, { name: 'shop' }, 'default')
    expect(created).toEqual(['shop', 'shop-preview'])
    expect(adapter.removeBranch).toBeUndefined()
  })

  it('is offered only to a project deployed to Cloudflare Workers', async () => {
    let platform: string | null = 'vercel'
    const state = new Map<string, unknown>()
    const resources = new ResourceService(
      {
        getState: <T>(key: string, fallback: T) => (state.get(key) as T) ?? fallback,
        setState: (key, value) => void state.set(key, value),
        stack: () => ({ database: true, migrate: null }),
        platform: () => platform,
      },
      { connected: () => true, auth: async () => ({ auth, accountId: 'acc1' }) } as never,
      undefined,
      // Every provider answers like D1 here; only which ones are offered matters.
      () => d1Adapter({ api: 'http://127.0.0.1:9' }),
    )
    expect((await resources.status('p1', [])).providers.map((entry) => entry.provider)).not.toContain('cloudflare-d1')
    await expect(resources.provision('p1', 'cloudflare-d1', 'default', 'shop')).rejects.toThrow('Cloudflare Workers')
    platform = 'cloudflare-workers'
    expect((await resources.status('p1', [])).providers.map((entry) => entry.provider)).toContain('cloudflare-d1')
  })
})
