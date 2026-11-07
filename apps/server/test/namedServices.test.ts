// Grafana and Amplitude as named services for dashboards, against local fakes of their APIs: the sign-in checked, a
// query's first frame turned into the table's rows, and a grant per dashboard.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { amplitudeAuth, amplitudeConnector } from '../src/interactive/amplitude'
import { grafanaAuth, grafanaConnector } from '../src/interactive/grafana'
import { salesforceConnector, startSalesforceSignIn } from '../src/interactive/salesforce'
import { ServiceGrants } from '../src/interactive/serviceGrants'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fake() {
  const requests: { line: string; auth: string | undefined; body: Record<string, unknown> }[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      requests.push({
        line: `${req.method} ${req.url}`,
        auth: req.headers.authorization,
        body: text ? JSON.parse(text) : {},
      })
      const send = (value: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      if (req.url === '/api/search?limit=1') return send([])
      if (req.url === '/api/ds/query')
        return send({
          results: {
            A: {
              frames: [
                {
                  schema: { fields: [{ name: 'Time' }, { name: 'Value' }] },
                  data: {
                    values: [
                      [1_700_000_000_000, 1_700_000_060_000],
                      [12, 15],
                    ],
                  },
                },
              ],
            },
          },
        })
      res.writeHead(404).end('{}')
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

it('checks the token, then runs a dashboard’s query with its data source and range', async () => {
  const { origin, requests } = await fake()
  const auth = { token: `${origin}|glsa_secret` }
  const connector = grafanaConnector()
  expect(await connector.account(auth)).toMatchObject({ id: origin })
  const rows = await connector.query(
    auth,
    { datasource: 'prom1', query: { expr: 'sum(up)' }, from: 'now-7d' },
    ['Value', 'Missing'],
    1,
  )
  expect(rows).toEqual([[12, null]])
  const query = requests.find((request) => request.line === 'POST /api/ds/query')!
  expect(query.auth).toBe('Bearer glsa_secret')
  expect(query.body).toEqual({
    from: 'now-7d',
    to: 'now',
    queries: [{ refId: 'A', datasource: { uid: 'prom1' }, expr: 'sum(up)' }],
  })
})

it('takes only an https address (or loopback) with the token, joined by |', () => {
  expect(grafanaAuth({ token: 'https://acme.grafana.net/x|glsa_1' })).toEqual({
    origin: 'https://acme.grafana.net',
    token: 'glsa_1',
  })
  expect(() => grafanaAuth({ token: 'glsa_1' })).toThrow('joined by |')
  expect(() => grafanaAuth({ token: 'http://acme.example|glsa_1' })).toThrow('joined by |')
})

it('keeps each dashboard’s grant on its own, and a table names one source only', () => {
  const state = new Map<string, unknown>()
  const grants = new ServiceGrants(
    <T>(key: string, fallback: T) => (state.get(key) as T) ?? fallback,
    (key, value) => void state.set(key, value),
  )
  expect(grants.allowed('a1')).toEqual([])
  expect(grants.set('a1', 'grafana', true)).toEqual(['grafana'])
  expect(grants.allowed('a2')).toEqual([])
  expect(grants.set('a1', 'grafana', false)).toEqual([])
  const table = {
    id: 'up',
    columns: ['Time', 'Value'],
    service: { id: 'grafana', datasource: 'prom1', query: { expr: 'up' } },
  }
  expect(
    parseArtifactSource({
      kind: 'dashboard',
      datasets: [table],
      figures: [{ label: 'Up', dataset: 'up', column: 'Value' }],
      charts: [],
    }).kind,
  ).toBe('dashboard')
  expect(() =>
    parseArtifactSource({
      kind: 'dashboard',
      datasets: [{ ...table, source: 'deployments' }],
      figures: [{ label: 'Up', dataset: 'up', column: 'Value' }],
      charts: [],
    }),
  ).toThrow('one of a source')
})

it('reads an Amplitude event’s daily uniques as date, series and value rows, with the project’s keys', async () => {
  const requests: { url: string; auth: string | undefined }[] = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', auth: req.headers.authorization })
    req.resume()
    req.on('end', () => {
      const send = (value: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      if (req.url === '/api/2/events/list') return send({ data: [] })
      if (req.url?.startsWith('/api/2/events/segmentation'))
        return send({ data: { series: [[4, 7]], xValues: ['2026-11-07', '2026-11-08'], seriesLabels: [0] } })
      res.writeHead(404).end('{}')
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const connector = amplitudeConnector({
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    now: () => new Date('2026-11-08T12:00:00Z'),
  })
  const auth = { token: 'key1:secret1' }
  expect(await connector.account(auth)).toMatchObject({ name: 'Amplitude project key1…' })
  const rows = await connector.query(auth, { event: 'Signed up', days: 2 }, ['date', 'value', 'series'], 10)
  expect(rows).toEqual([
    ['2026-11-07', 4, 'Signed up'],
    ['2026-11-08', 7, 'Signed up'],
  ])
  const segmentation = new URL(requests.find((request) => request.url.includes('segmentation'))!.url, 'http://x')
  expect(Object.fromEntries(segmentation.searchParams)).toEqual({
    e: '{"event_type":"Signed up"}',
    start: '20261107',
    end: '20261108',
    m: 'uniques',
    i: '1',
  })
  expect(requests[0]?.auth).toBe(`Basic ${Buffer.from('key1:secret1').toString('base64')}`)
  expect(amplitudeAuth({ token: 'eu|k:s' }).origin).toBe('https://analytics.eu.amplitude.com')
  expect(() => amplitudeAuth({ token: 'only-a-key' })).toThrow('joined by a colon')
})

it('signs in to Salesforce with PKCE through the person’s connected app, and queries with SOQL', async () => {
  const exchanges: URLSearchParams[] = []
  const queries: string[] = []
  const org = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    req.on('end', () => {
      const send = (value: unknown) =>
        void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      expect(req.headers.authorization).toBe('Bearer access-1')
      if (req.url === '/services/data/') return send([])
      if (req.url === '/services/oauth2/userinfo')
        return send({ user_id: 'u1', organization_id: 'o1', preferred_username: 'ana@acme.com' })
      if (req.url?.startsWith('/services/data/v62.0/query?')) {
        queries.push(req.url)
        return send({
          records: [{ attributes: {}, StageName: 'Prospecting', Amount: 1200, Account: { Name: 'Acme' } }],
          nextRecordsUrl: queries.length === 1 ? '/services/data/v62.0/query/01g-2000' : undefined,
        })
      }
      if (req.url === '/services/data/v62.0/query/01g-2000') {
        queries.push(req.url)
        return send({ records: [{ StageName: 'Closed Won', Amount: 900, Account: null }] })
      }
      res.writeHead(404).end(text)
    })
  })
  servers.push(org)
  await new Promise<void>((resolve) => org.listen(0, '127.0.0.1', resolve))
  const instance = `http://127.0.0.1:${(org.address() as AddressInfo).port}`
  // Salesforce's token endpoint, faked: it checks the PKCE verifier against the challenge sent with the link.
  let challenge = ''
  const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body))
    exchanges.push(body)
    const verified = createHash('sha256').update(body.get('code_verifier')!).digest('base64url') === challenge
    return new Response(
      JSON.stringify(
        verified ? { access_token: 'access-1', refresh_token: 'refresh-1', instance_url: instance } : { error: 'bad' },
      ),
      { status: verified ? 200 : 400 },
    )
  })
  const flow = await startSalesforceSignIn({
    clientId: 'consumer-key-1',
    sandbox: true,
    fetch: fetcher as never,
    port: 0,
  })
  const link = new URL(flow.url)
  expect(link.origin).toBe('https://test.salesforce.com')
  expect(link.searchParams.get('client_id')).toBe('consumer-key-1')
  expect(link.searchParams.get('scope')).toBe('api refresh_token')
  challenge = link.searchParams.get('code_challenge')!
  const callback = new URL(link.searchParams.get('redirect_uri')!)
  // The browser comes back with the code; a callback with another state is refused.
  const wrong = await fetch(`${callback.origin}${callback.pathname}?code=c&state=other`)
  expect(wrong.status).toBe(400)
  await fetch(`${callback.origin}${callback.pathname}?code=code-1&state=${link.searchParams.get('state')}`)
  const grant = await flow.done
  expect(grant).toMatchObject({
    token: `${instance}|access-1`,
    refreshToken: 'refresh-1',
    oauthClient: { url: 'https://test.salesforce.com/services/oauth2/token', client: 'consumer-key-1' },
  })
  expect(exchanges[0]?.get('grant_type')).toBe('authorization_code')
  const connector = salesforceConnector()
  expect(await connector.account({ token: grant.token })).toMatchObject({ id: 'o1:u1', name: 'ana@acme.com' })
  const rows = await connector.query(
    { token: grant.token },
    { soql: 'SELECT StageName, Amount, Account.Name FROM Opportunity' },
    ['StageName', 'Amount', 'Account.Name'],
    10,
  )
  expect(rows).toEqual([
    ['Prospecting', 1200, 'Acme'],
    ['Closed Won', 900, null],
  ])
  await expect(connector.query({ token: grant.token }, { soql: 'DELETE FROM x' }, ['Id'], 1)).rejects.toThrow('SELECT')
})
