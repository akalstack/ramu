// Cloudflare D1, KV and R2 as resource adapters, against a local fake of Cloudflare's API: each resource and its
// preview copy made once and reused, offered only to a project deployed to Cloudflare Workers, and needed when the
// Worker's code types a binding as one.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ResourceService } from '../src/workspace/deploy/resources'
import { workerResourceAdapter, type WorkerProvider } from '../src/workspace/deploy/workerResources'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

/** Cloudflare's replies for one account, in each API's own shape. */
async function fake() {
  const made: Record<string, { id: string; name: string }[]> = { d1: [], kv: [], r2: [] }
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      expect(req.headers.authorization).toBe('Bearer cf_token')
      const url = new URL(req.url ?? '/', 'http://fake')
      const send = (result: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result }))
      if (url.pathname === '/accounts') return send([{ id: 'acc1', name: 'Ana' }])
      const route = /^\/accounts\/acc1\/(d1\/database|storage\/kv\/namespaces|r2\/buckets)(?:\/([\w-]+))?$/.exec(
        url.pathname,
      )
      if (!route) return void res.writeHead(404).end('{"result":null}')
      const kind = route[1]!.startsWith('d1') ? 'd1' : route[1]!.startsWith('storage') ? 'kv' : 'r2'
      const list = made[kind]!
      const shape = (entry: { id: string; name: string }) =>
        kind === 'd1'
          ? { uuid: entry.id, name: entry.name }
          : kind === 'kv'
            ? { id: entry.id, title: entry.name }
            : { name: entry.name }
      if (req.method === 'POST') {
        const body = JSON.parse(text) as { name?: string; title?: string }
        const name = (body.name ?? body.title)!
        const entry = { id: kind === 'r2' ? name : `${kind}-${list.length + 1}`, name }
        list.push(entry)
        return send(shape(entry))
      }
      if (route[2]) {
        const found = list.find((entry) => entry.id === route[2])
        return found ? send(shape(found)) : void res.writeHead(404).end('{"result":null}')
      }
      return send(kind === 'r2' ? { buckets: list.map(shape) } : list.map(shape))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, made }
}

const auth = { token: 'cf_token', scope: null }

describe('Cloudflare resources for Workers', () => {
  it.each<[WorkerProvider, string]>([
    ['cloudflare-d1', 'd1'],
    ['cloudflare-kv', 'kv'],
    ['cloudflare-r2', 'r2'],
  ])('%s makes the resource and a preview copy once, and names both for the binding', async (provider, kind) => {
    const { url, made } = await fake()
    const adapter = workerResourceAdapter(provider, { api: url })
    expect(await adapter.account(auth)).toMatchObject({ id: 'acc1', defaultScope: 'acc1' })
    const resource = await adapter.provision(auth, { name: 'shop' }, 'default')
    // A Worker reaches it through its binding, so nothing is set as a variable.
    expect(resource.variables).toEqual({})
    expect(await adapter.branch!(auth, resource.id, 'preview')).toEqual({})
    const pair = await adapter.pair(auth, resource.id)
    expect(pair).toMatchObject({ name: 'shop', id: resource.id })
    expect(pair.previewId).not.toBe(pair.id)
    await adapter.provision(auth, { name: 'shop' }, 'default')
    expect(made[kind]!.map((entry) => entry.name)).toEqual(['shop', 'shop-preview'])
    expect(adapter.removeBranch).toBeUndefined()
  })

  it('offers them only to a Workers project, and needs each when the code types a binding as one', async () => {
    let platform: string | null = 'vercel'
    const state = new Map<string, unknown>()
    const resources = new ResourceService(
      {
        getState: <T>(key: string, fallback: T) => (state.get(key) as T) ?? fallback,
        setState: (key, value) => void state.set(key, value),
        stack: () => ({ database: false, migrate: null }),
        platform: () => platform,
      },
      { connected: () => true, auth: async () => ({ auth, accountId: 'acc1' }) } as never,
      undefined,
      // Every provider answers like D1 here; only which ones are offered and needed matters.
      () => workerResourceAdapter('cloudflare-d1', { api: 'http://127.0.0.1:9' }),
    )
    const vercel = await resources.status('p1', [], ['KVNamespace', 'R2Bucket'])
    expect(vercel.providers.map((entry) => entry.provider)).not.toContain('cloudflare-kv')
    expect(vercel.needs).toEqual([])
    await expect(resources.provision('p1', 'cloudflare-r2', 'default', 'shop')).rejects.toThrow('Cloudflare Workers')
    platform = 'cloudflare-workers'
    const workers = await resources.status('p1', [], ['KVNamespace', 'R2Bucket'])
    expect(workers.providers.map((entry) => entry.provider)).toEqual(
      expect.arrayContaining(['cloudflare-d1', 'cloudflare-kv', 'cloudflare-r2']),
    )
    expect(workers.needs).toEqual(['cache', 'storage'])
  })
})
