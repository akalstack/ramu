// A Vercel Marketplace database, against a local fake of Vercel's API: the first installed database integration's
// product, created on its free plan in the project's team and connected to the project for every environment.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { vercelMarketplaceAdapter } from '../src/workspace/deploy/vercelMarketplace'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fake(installed: boolean) {
  const requests: { line: string; body: Record<string, unknown> }[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake')
      requests.push({ line: `${req.method} ${url.pathname}${url.search}`, body: text ? JSON.parse(text) : {} })
      const send = (value: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      if (url.pathname === '/v1/integrations/configurations')
        return send(installed ? [{ id: 'icfg_1', slug: 'neon' }] : [])
      if (url.pathname === '/v1/integrations/configuration/icfg_1/products')
        return send({
          products: [
            { id: 'iap_auth', slug: 'neon-auth', name: 'Auth', protocols: {} },
            { id: 'iap_postgres', slug: 'neon', name: 'Neon Postgres', protocols: { storage: {} } },
          ],
        })
      if (url.pathname === '/v1/storage/stores/integration/direct')
        return send({ store: { id: 'store_1', name: 'shop', secrets: [{ name: 'DATABASE_URL', length: 80 }] } })
      if (url.pathname === '/v1/integrations/installations/icfg_1/resources/store_1/connections') return send({})
      res.writeHead(404).end('{}')
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

it('creates the database on the installed integration in the project’s team and connects it everywhere', async () => {
  const { url, requests } = await fake(true)
  const adapter = vercelMarketplaceAdapter({ api: url })
  const made = await adapter.provision({ token: 't', scope: 'team_1' }, { name: 'shop', site: 'prj_1' }, 'default')
  // Vercel keeps the values and sets them on the project; Ramu holds none.
  expect(made).toEqual({ id: 'store_1', name: 'shop', variables: {} })
  const created = requests.find((request) => request.line.startsWith('POST /v1/storage/stores/integration/direct'))!
  expect(created.line).toContain('teamId=team_1')
  expect(created.body).toMatchObject({
    integrationConfigurationId: 'icfg_1',
    integrationProductIdOrSlug: 'iap_postgres',
  })
  const connected = requests.find((request) => request.line.includes('/connections'))!
  expect(connected.body).toEqual({
    projectId: 'prj_1',
    envVarEnvironments: ['production', 'preview', 'development'],
    makeEnvVarsSensitive: true,
  })
})

it('says to install a database integration first, and needs the project linked', async () => {
  const { url } = await fake(false)
  const adapter = vercelMarketplaceAdapter({ api: url })
  await expect(adapter.provision({ token: 't' }, { name: 'shop', site: 'prj_1' }, 'default')).rejects.toThrow(
    'Install a database integration',
  )
  await expect(adapter.provision({ token: 't' }, { name: 'shop' }, 'default')).rejects.toThrow('Link the project')
})
