import { describe, expect, it } from 'vitest'
import {
  readMarketplace,
  listingMatches,
  checkQuery,
  fillBody,
  marketplaceFile,
  parseInstallLink,
  pluginInstallLink,
  pluginJsonSchema,
  pluginManifest,
  readRamuExtension,
  resolveIndexSource,
  dataSourceRows,
  fillTemplate,
} from '../src/plugins'

const manifest = (extension: unknown) =>
  pluginManifest.parse({ name: 'render', extensions: { 'dev.getramu': extension } })

describe('plugin manifest', () => {
  it('reads a Claude Code manifest with no Ramu block', () => {
    const parsed = pluginManifest.parse({ name: 'docs-helper', version: '1.0.0', author: 'Ada', hooks: './hooks.json' })
    expect(parsed.author).toEqual({ name: 'Ada' })
    expect(readRamuExtension(parsed, 'plugin.json').problems).toEqual([])
  })

  it('refuses names Claude Code would refuse', () => {
    expect(pluginManifest.safeParse({ name: 'Render Deploy' }).success).toBe(false)
  })

  it('names each problem in the Ramu block', () => {
    const { problems } = readRamuExtension(
      manifest({
        credentials: [{ id: 'token', label: 'API key', env: 'RENDER_API_KEY', kind: 'token' }],
        cli: { binaries: ['render'], reads: [['  ']] },
        abilities: { vision: { server: 'render', tool: 'look' } },
        dataSources: [
          {
            id: 'render',
            label: 'Render',
            credential: 'missing',
            request: { url: 'https://api.render.com/v1/services' },
            rows: { shape: 'objects' },
          },
        ],
      }),
      'plugin.json',
    )
    const messages = problems.map((problem) => problem.message).join('\n')
    expect(messages).toContain('read-only prefix is empty')
    expect(messages).toContain('vision is not an ability')
    expect(messages).toContain('credential missing')
  })

  it('refuses reserved environment and a host taken from a value', () => {
    expect(
      readRamuExtension(manifest({ credentials: [{ id: 't', label: 'T', env: 'PATH', kind: 'token' }] }), 'p').problems,
    ).not.toEqual([])
    const { problems } = readRamuExtension(
      manifest({
        credentials: [{ id: 't', label: 'T', env: 'X_TOKEN', kind: 'token' }],
        dataSources: [
          {
            id: 'x',
            label: 'X',
            credential: 't',
            request: { url: 'https://{query.host}/api' },
            rows: { shape: 'objects' },
          },
        ],
      }),
      'p',
    )
    expect(problems.map((problem) => problem.message).join()).toContain('host may not come from a value')
  })

  it('accepts a url field as the origin and refuses a POST that does not say it only reads', () => {
    const slot = {
      id: 'grafana',
      label: 'Grafana',
      env: 'GRAFANA_TOKEN',
      kind: 'token',
      fields: [{ id: 'url', label: 'Address', env: 'GRAFANA_URL', kind: 'url' }],
    }
    const source = {
      id: 'grafana',
      label: 'Grafana',
      credential: 'grafana',
      request: { method: 'POST', url: '{field.url}/api/ds/query' },
      rows: { shape: 'objects' },
    }
    expect(
      readRamuExtension(manifest({ credentials: [slot], dataSources: [{ ...source, readOnly: true }] }), 'p').problems,
    ).toEqual([])
    expect(readRamuExtension(manifest({ credentials: [slot], dataSources: [source] }), 'p').problems).not.toEqual([])
  })
})

describe('JSON Schema', () => {
  it('describes the manifest with Ramu’s block for editors', () => {
    const schema = pluginJsonSchema() as {
      $id: string
      properties: Record<string, { properties?: Record<string, unknown> }>
    }
    expect(schema.$id).toBe('https://getramu.dev/schema/plugin.json')
    expect(schema.properties.name).toBeDefined()
    expect(schema.properties.extensions?.properties?.['dev.getramu']).toBeDefined()
  })
})

describe('indexes', () => {
  it('reads a Claude Code marketplace and resolves its sources', () => {
    const file = marketplaceFile.parse({
      name: 'ramu-plugins',
      owner: { name: 'Akalstack' },
      plugins: [
        { name: 'railway', source: './plugins/railway' },
        { name: 'render', source: { source: 'github', repo: 'acme/render-plugin', sha: 'a'.repeat(40) } },
      ],
    })
    const index = { url: 'https://github.com/akalstack/ramu-plugins' }
    expect(resolveIndexSource(file.plugins[0]!.source, index)).toEqual({ url: index.url, path: 'plugins/railway' })
    expect(resolveIndexSource(file.plugins[1]!.source, index)).toMatchObject({
      url: 'https://github.com/acme/render-plugin',
      sha: 'a'.repeat(40),
    })
  })

  it('round-trips the install link', () => {
    expect(parseInstallLink(pluginInstallLink('https://github.com/acme/x', 'ramu-plugins'))).toEqual({
      source: 'https://github.com/acme/x',
      index: 'ramu-plugins',
    })
    expect(parseInstallLink('https://example.com')).toBeNull()
  })
})

describe('data sources', () => {
  it('turns Grafana frames into rows by column name', () => {
    const response = {
      results: {
        A: {
          frames: [
            {
              schema: { fields: [{ name: 'time' }, { name: 'value' }] },
              data: {
                values: [
                  [1, 2],
                  [5, 6],
                ],
              },
            },
          ],
        },
      },
    }
    const shape = {
      shape: 'columns' as const,
      names: 'results.A.frames.0.schema.fields',
      nameKey: 'name',
      values: 'results.A.frames.0.data.values',
    }
    expect(dataSourceRows(response, shape, ['time', 'value', 'missing'], 10)).toEqual([
      { time: 1, value: 5, missing: null },
      { time: 2, value: 6, missing: null },
    ])
  })

  it('turns Amplitude series into date rows named after the event', () => {
    const shape = {
      shape: 'series' as const,
      dates: 'data.xValues',
      values: 'data.series',
      labels: 'data.seriesLabels',
      label: '{query.event}',
    }
    expect(
      dataSourceRows(
        { data: { xValues: ['2026-11-01', '2026-11-02'], series: [[3, 4]], seriesLabels: [0] } },
        shape,
        ['date', 'series', 'value'],
        10,
        { event: 'signup' },
      ),
    ).toEqual([
      { date: '2026-11-01', series: 'signup', value: 3 },
      { date: '2026-11-02', series: 'signup', value: 4 },
    ])
  })

  it('reads Salesforce records by relationship path', () => {
    expect(
      dataSourceRows(
        { records: [{ StageName: 'Won', Account: { Name: 'Acme' } }] },
        { shape: 'objects', path: 'records' },
        ['StageName', 'Account.Name'],
        10,
      ),
    ).toEqual([{ StageName: 'Won', 'Account.Name': 'Acme' }])
  })

  it('fills dates and JSON values', () => {
    const now = new Date('2026-11-09T12:00:00Z')
    expect(fillTemplate('{date.since.days}-{date.today}', { token: '', fields: {}, query: { days: 30 }, now })).toBe(
      '20261011-20261109',
    )
    expect(fillTemplate('{"event_type":{query.event:json}}', { token: '', fields: {}, query: { event: 'a"b' } })).toBe(
      '{"event_type":"a\\"b"}',
    )
    expect(fillTemplate('Basic {basic.secret}', { token: 'key', fields: { secret: 's' } })).toBe(
      `Basic ${btoa('key:s')}`,
    )
  })

  it('checks a query against its fields', () => {
    const fields = [
      { name: 'soql', type: 'string' as const, pattern: '^\\s*SELECT\\b', maxLength: 4000, required: true },
      { name: 'days', type: 'number' as const, min: 1, max: 365, default: 30, maxLength: 500, required: false },
    ]
    expect(checkQuery(fields, { soql: 'SELECT Id FROM Account' })).toEqual({
      ok: true,
      query: { soql: 'SELECT Id FROM Account', days: 30 },
    })
    expect(checkQuery(fields, { soql: 'DELETE Account' })).toMatchObject({ ok: false })
    expect(checkQuery(fields, { soql: 'SELECT Id FROM Account', days: 900 })).toMatchObject({ ok: false })
    expect(checkQuery(fields, { soql: 'SELECT 1', host: 'evil' })).toMatchObject({ ok: false })
  })

  it('merges a query object into a body', () => {
    expect(
      fillBody(
        { queries: [{ refId: 'A', '...': '{query.query}' }] },
        { token: '', fields: {}, query: { query: { expr: 'up', refId: 'B' } } },
      ),
    ).toEqual({
      queries: [{ expr: 'up', refId: 'A' }],
    })
  })

  it('keeps a whole query value as its own type in a body', () => {
    expect(
      fillBody(
        { queries: [{ expr: '{query.expr}', n: '{query.n}' }], from: 'now-{query.n}h' },
        { token: '', fields: {}, query: { expr: 'up', n: 6 } },
      ),
    ).toEqual({
      queries: [{ expr: 'up', n: 6 }],
      from: 'now-6h',
    })
  })
})

describe('listingMatches', () => {
  const listing = {
    index: 'https://example.com/index',
    indexName: 'Example',
    name: 'render',
    description: 'Deploy web services',
    source: 'https://example.com/render',
    commit: null,
    byRamu: false,
    signed: true,
    stacks: ['node'],
    keywords: ['hosting'],
    category: null,
    installed: false,
    alternatives: [],
  }
  it('matches every typed word anywhere in what the listing says about itself', () => {
    expect(listingMatches(listing, '')).toBe(true)
    expect(listingMatches(listing, 'Render hosting')).toBe(true)
    expect(listingMatches(listing, 'node deploy')).toBe(true)
    expect(listingMatches(listing, 'render python')).toBe(false)
  })
})

describe('readMarketplace', () => {
  it('skips a listing it cannot use and shortens a long description, keeping the rest of the index', () => {
    const read = readMarketplace({
      name: 'claude-plugins-official',
      plugins: [
        { name: 'linear', source: './external_plugins/linear', description: 'x'.repeat(1500) },
        { name: 'xcode', source: { source: 'command', command: 'xcrun agent plugin path' } },
      ],
    })
    expect(read.plugins.map((entry) => entry.name)).toEqual(['linear'])
    expect(read.plugins[0]!.description).toHaveLength(1000)
    expect(read.skipped).toEqual(['xcode'])
  })
})
