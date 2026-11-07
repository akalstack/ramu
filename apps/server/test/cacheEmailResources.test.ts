// Upstash and Resend as resource adapters, against local fakes of their APIs: a Redis cache with a second database for
// previews, and sending-only keys for email, never the person's own key.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { resendAdapter } from '../src/workspace/deploy/resend'
import { upstashAdapter } from '../src/workspace/deploy/upstash'

interface Request {
  line: string
  authorization: string | undefined
  body: Record<string, unknown>
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fake(answer: (request: Request) => unknown) {
  const requests: Request[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      const request = {
        line: `${req.method} ${req.url}`,
        authorization: req.headers.authorization,
        body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      }
      requests.push(request)
      const reply = answer(request)
      if (reply === undefined) return void res.writeHead(404).end('{}')
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

describe('Upstash', () => {
  const databases: Record<string, unknown>[] = []
  const upstash = () =>
    fake(({ line, body }) => {
      if (line === 'GET /redis/databases') return databases
      if (line === 'POST /redis/database') {
        const id = `db${databases.length + 1}`
        const made = {
          database_id: id,
          database_name: body.database_name,
          endpoint: `${id}.upstash.io`,
          port: 6379,
          password: `pw-${id}`,
          rest_token: `rest-${id}`,
          creation_time: Math.floor(Date.now() / 1000),
        }
        databases.push(made)
        return made
      }
      const one = /^GET \/redis\/database\/(\w+)$/.exec(line)
      return one ? databases.find((entry) => entry.database_id === one[1]) : undefined
    })
  const auth = { token: 'ana@example.com:key-1', scope: null }

  it('signs in with the email and key as Basic credentials, and refuses a bare key plainly', async () => {
    databases.length = 0
    const { url, requests } = await upstash()
    const adapter = upstashAdapter({ api: url })
    expect(await adapter.account(auth)).toMatchObject({ id: 'ana@example.com' })
    expect(requests[0]?.authorization).toBe(`Basic ${Buffer.from('ana@example.com:key-1').toString('base64')}`)
    await expect(adapter.account({ token: 'key-only', scope: null })).rejects.toThrow('joined by a colon')
  })

  it('creates a TLS cache with Redis and REST values, and a second database for previews', async () => {
    databases.length = 0
    const { url, requests } = await upstash()
    const adapter = upstashAdapter({ api: url })
    const made = await adapter.provision(auth, { name: 'shop' }, 'default')
    expect(made).toEqual({
      id: 'db1',
      name: 'shop',
      variables: {
        REDIS_URL: 'rediss://default:pw-db1@db1.upstash.io:6379',
        UPSTASH_REDIS_REST_URL: 'https://db1.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'rest-db1',
      },
    })
    expect(requests.find((request) => request.line === 'POST /redis/database')?.body).toMatchObject({
      database_name: 'shop',
      tls: true,
    })
    const preview = await adapter.branch!(auth, 'db1', 'preview')
    expect(preview.REDIS_URL).toContain('db2.upstash.io')
    // Asking again reuses the preview database instead of making a third.
    await adapter.branch!(auth, 'db1', 'preview')
    expect(databases).toHaveLength(2)
  })

  it('never takes over an older database of the same name', async () => {
    databases.length = 0
    databases.push({ database_id: 'old', database_name: 'shop', endpoint: 'old', port: 6379, creation_time: 1 })
    const { url } = await upstash()
    await expect(upstashAdapter({ api: url }).provision(auth, { name: 'shop' }, 'default')).rejects.toThrow(
      'does not take over',
    )
  })
})

describe('Resend', () => {
  it('gives the app sending-only keys, one for production and one for previews, never the full-access key', async () => {
    let made = 0
    const { url, requests } = await fake(({ line }) =>
      line === 'GET /domains'
        ? { data: [{ id: 'dom_1', name: 'shop.example' }] }
        : line === 'POST /api-keys'
          ? { id: `key_${++made}`, token: `re_sending_${made}` }
          : undefined,
    )
    const adapter = resendAdapter({ api: url })
    const auth = { token: 're_full_access', scope: null }
    expect(await adapter.account(auth)).toMatchObject({ id: 'dom_1', name: 'shop.example' })
    const production = await adapter.provision(auth, { name: 'shop' }, 'default')
    const preview = await adapter.branch!(auth, production.id, 'preview')
    expect(production.variables).toEqual({ RESEND_API_KEY: 're_sending_1' })
    expect(preview).toEqual({ RESEND_API_KEY: 're_sending_2' })
    const keys = requests.filter((request) => request.line === 'POST /api-keys').map((request) => request.body)
    expect(keys).toEqual([
      { name: 'shop', permission: 'sending_access' },
      { name: 'shop-preview', permission: 'sending_access' },
    ])
    expect(JSON.stringify([production, preview])).not.toContain('re_full_access')
    // A key's value is shown only once, so a lost reply cannot be recovered by name.
    expect(await adapter.find(auth, 'shop')).toBeNull()
  })
})
