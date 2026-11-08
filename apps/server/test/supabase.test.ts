// Supabase as a resource adapter, against a local fake of its Management API: a project for production and a second
// one for previews, connection values from the pooler, and a project of the same name Ramu did not make left alone.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { supabaseAdapter } from '../src/workspace/deploy/supabase'
import { supabaseStorageAdapter } from '../src/workspace/deploy/supabaseStorage'

interface Project {
  id: string
  ref: string
  name: string
  status: string
  created_at: string
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

/** Supabase's replies for one organization; a new project answers COMING_UP once, then ACTIVE_HEALTHY. */
async function fake(projects: Project[]) {
  const requests: { line: string; body: Record<string, unknown> }[] = []
  const looked = new Set<string>()
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer sbp_token')
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>
      const line = `${req.method} ${req.url}`
      requests.push({ line, body })
      const send = (value: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      if (line === 'GET /organizations') return send([{ id: 'org_1', slug: 'ana-org', name: 'Ana' }])
      if (line === 'GET /projects') return send(projects)
      if (line === 'POST /projects') {
        const ref = `ref${projects.length + 1}`
        const made = {
          id: ref,
          ref,
          name: String(body.name),
          status: 'COMING_UP',
          created_at: new Date().toISOString(),
        }
        projects.push(made)
        return send(made)
      }
      const project = /^\/projects\/(\w+)(\/.*)?$/.exec(req.url ?? '')
      const found = projects.find((entry) => entry.ref === project?.[1])
      if (!project || !found) return void res.writeHead(404).end('{}')
      if (!project[2] && req.method === 'GET') {
        const status = looked.has(found.ref) ? 'ACTIVE_HEALTHY' : found.status
        looked.add(found.ref)
        return send({ ...found, status })
      }
      if (project[2] === '/config/database/pooler')
        return send([
          {
            database_type: 'PRIMARY',
            db_user: `postgres.${found.ref}`,
            db_host: 'aws-0-eu-central-1.pooler.supabase.com',
            db_port: 6543,
            db_name: 'postgres',
          },
        ])
      if (project[2] === '/database/password' && req.method === 'PATCH') return send({ message: 'ok' })
      if (project[2] === '/analytics/endpoints/usage.api-counts?interval=7day')
        return send({
          result: [
            { total_rest_requests: 100, total_auth_requests: 5, total_storage_requests: 2, total_realtime_requests: 0 },
            { total_rest_requests: 40, total_auth_requests: 1, total_storage_requests: 0, total_realtime_requests: 3 },
          ],
        })
      res.writeHead(500).end(`no recorded reply for ${line}`)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { adapter: supabaseAdapter({ api: url, pause: async () => {} }), requests }
}

const auth = { token: 'sbp_token', scope: null }

describe('Supabase', () => {
  it('names the account by its first organization', async () => {
    const { adapter } = await fake([])
    expect(await adapter.account(auth)).toMatchObject({ id: 'ana-org', name: 'Ana' })
  })

  it('creates a project with a password of its own, waits for it, and connects through the pooler', async () => {
    const { adapter, requests } = await fake([])
    const made = await adapter.provision(auth, { name: 'shop' }, 'default')
    const created = requests.find((request) => request.line === 'POST /projects')!
    expect(created.body).toMatchObject({ name: 'shop', organization_slug: 'ana-org' })
    const secret = String(created.body.db_pass)
    expect(secret.length).toBeGreaterThanOrEqual(24)
    expect(made).toEqual({
      id: 'ref1',
      name: 'shop',
      variables: {
        DATABASE_URL: `postgresql://postgres.ref1:${secret}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
        DATABASE_URL_UNPOOLED: `postgresql://postgres.ref1:${secret}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      },
    })
    // The token goes only in the Authorization header.
    expect(requests.map((request) => request.line).join('\n')).not.toContain('sbp_token')
  })

  it('gives previews a second project, made once and reused with a new password', async () => {
    const { adapter, requests } = await fake([])
    const main = await adapter.provision(auth, { name: 'shop' }, 'default')
    const preview = await adapter.branch!(auth, main.id, 'preview')
    expect(preview.DATABASE_URL).toContain('postgres.ref2:')
    const again = await adapter.branch!(auth, main.id, 'preview')
    expect(again.DATABASE_URL).toContain('postgres.ref2:')
    expect(requests.filter((request) => request.line === 'POST /projects')).toHaveLength(2)
    expect(requests.some((request) => request.line === 'PATCH /projects/ref2/database/password')).toBe(true)
    // No branch per pull request: Supabase branching needs a paid plan.
    expect(adapter.removeBranch).toBeUndefined()
  })

  it('reports the last seven days of requests per service, the span Supabase’s API covers', async () => {
    const { adapter } = await fake([
      { id: 'ref1', ref: 'ref1', name: 'shop', status: 'ACTIVE_HEALTHY', created_at: '' },
    ])
    const usage = await adapter.usage!(auth, 'ref1')
    expect(usage.figures.map((figure) => [figure.service, figure.used, figure.limit])).toEqual([
      ['Database API requests', 140, null],
      ['Auth requests', 6, null],
      ['Storage requests', 2, null],
      ['Realtime requests', 3, null],
    ])
    expect(usage.period!.end! - usage.period!.start).toBe(7 * 24 * 60 * 60_000)
  })

  it('never takes over an older project of the same name', async () => {
    const old = { id: 'old', ref: 'old', name: 'shop', status: 'ACTIVE_HEALTHY', created_at: '2024-01-01T00:00:00Z' }
    const { adapter, requests } = await fake([old])
    await expect(adapter.provision(auth, { name: 'shop' }, 'default')).rejects.toThrow(
      'Ramu does not take over a database it did not make',
    )
    await expect(adapter.find(auth, 'shop')).rejects.toThrow('already exists')
    expect(requests.some((request) => request.line.startsWith('PATCH'))).toBe(false)
  })
})

describe('Supabase Storage', () => {
  async function storageFake() {
    const buckets: { ref: string; id: string }[] = []
    const requests: { line: string; auth: string | undefined }[] = []
    const server = createServer((req, res) => {
      let text = ''
      req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
      req.on('end', () => {
        requests.push({ line: `${req.method} ${req.url}`, auth: req.headers.authorization })
        const send = (status: number, value: unknown) =>
          void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
        if (req.url === '/projects')
          return send(200, [
            { id: 'ref1', ref: 'ref1', name: 'shop' },
            { id: 'ref2', ref: 'ref2', name: 'shop-preview' },
          ])
        const keys = /^\/projects\/(\w+)\/api-keys\?reveal=true$/.exec(req.url ?? '')
        if (keys)
          return send(200, [
            { name: 'anon', type: 'legacy', api_key: 'anon-key' },
            { name: 'default', type: 'secret', api_key: `sb_secret_${keys[1]}` },
          ])
        const made = /^\/storage\/(\w+)\/bucket$/.exec(req.url ?? '')
        if (made) {
          const { id } = JSON.parse(text) as { id: string }
          if (buckets.some((entry) => entry.ref === made[1] && entry.id === id))
            return send(409, { message: 'The resource already exists' })
          buckets.push({ ref: made[1]!, id })
          return send(200, { name: id })
        }
        send(404, {})
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return {
      adapter: supabaseStorageAdapter({ api: url, storage: (ref) => `${url}/storage/${ref}` }),
      buckets,
      requests,
    }
  }

  it('makes a private bucket in the database’s project and its preview project, with the secret key', async () => {
    const { adapter, buckets, requests } = await storageFake()
    const made = await adapter.provision(
      auth,
      { name: 'Shop', database: { provider: 'supabase', id: 'ref1' } },
      'default',
    )
    expect(made.variables).toEqual({
      SUPABASE_URL: 'https://ref1.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_ref1',
      SUPABASE_STORAGE_BUCKET: 'shop',
    })
    expect(requests.find((request) => request.line.includes('/bucket'))?.auth).toBe('Bearer sb_secret_ref1')
    expect((await adapter.branch!(auth, 'ref1', 'preview')).SUPABASE_URL).toBe('https://ref2.supabase.co')
    // Provisioning again reuses the bucket made before.
    await adapter.provision(auth, { name: 'Shop', database: { provider: 'supabase', id: 'ref1' } }, 'default')
    expect(buckets).toEqual([
      { ref: 'ref1', id: 'shop' },
      { ref: 'ref2', id: 'shop' },
    ])
  })

  it('needs a Supabase database first', async () => {
    const { adapter } = await storageFake()
    await expect(adapter.provision(auth, { name: 'shop' }, 'default')).rejects.toThrow('Supabase database')
  })
})
