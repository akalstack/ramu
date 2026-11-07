// Grafana as a named service for dashboards, against a local fake of its API: the token checked through search, a
// query's first frame turned into the table's rows, and a grant per dashboard.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { grafanaAuth, grafanaConnector } from '../src/interactive/grafana'
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
