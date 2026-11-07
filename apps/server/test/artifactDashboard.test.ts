import { expect, it, vi } from 'vitest'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { LiveDashboards, refreshMs, watchDashboards, type ReadDashboardSource } from '../src/interactive/liveDashboard'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { dashboardCsv } from '@ramu/shared/interactiveExport'
import { aggregate, dashboardChart, renderDashboard } from '../src/interactive/dashboard'
import { tableFromFile } from '../src/interactive/dashboardFile'

const SIGNUPS = {
  id: 'signups',
  columns: ['day', 'plan', 'count'],
  rows: [
    ['Mon', 'free', 4],
    ['Mon', 'pro', 1],
    ['Tue', 'free', 6],
    ['Wed', 'free', null],
  ],
  asOf: '2026-11-07T09:40:00Z',
}
const board = (patch: Record<string, unknown> = {}) =>
  parseArtifactSource({
    kind: 'dashboard',
    datasets: [SIGNUPS],
    figures: [{ label: 'Signups', dataset: 'signups', column: 'count' }],
    charts: [{ title: 'By day', type: 'bar', dataset: 'signups', x: 'day', y: ['count'] }],
    ...patch,
  })

it('checks that every figure and chart names a table and columns that exist, and adds up only numbers', () => {
  expect(() => board({ figures: [{ label: 'X', dataset: 'missing', column: 'count' }] })).toThrow(
    'The figure "X" uses missing, which is not in datasets.',
  )
  expect(() => board({ charts: [{ title: 'Plans', type: 'bar', dataset: 'signups', x: 'day', y: ['plan'] }] })).toThrow(
    'adds up plan, but some of its values are not numbers',
  )
  expect(() => board({ figures: [], charts: [] })).toThrow('at least one figure or chart')
  expect(board({ figures: [{ label: 'Rows', dataset: 'signups', column: 'plan', aggregate: 'count' }] }).kind).toBe(
    'dashboard',
  )
})

it('works out figures and adds up chart rows per category', () => {
  expect(aggregate([4, 1, 6, null], 'sum')).toBe(11)
  expect(aggregate([4, 1, 6, null], 'average')).toBeCloseTo(11 / 3)
  expect(aggregate([4, null, ''], 'count')).toBe(1)
  expect(aggregate([null], 'max')).toBeNull()
  expect(dashboardChart(SIGNUPS, { title: 'By day', type: 'bar', dataset: 'signups', x: 'day', y: ['count'] })).toEqual(
    { type: 'bar', labels: ['Mon', 'Tue', 'Wed'], series: [{ name: 'count', values: [5, 6, 0] }] },
  )
})

it('draws figures and charts with when the data was read, and keeps its tables for export', () => {
  const source = board()
  if (source.kind !== 'dashboard') throw new Error('not a dashboard')
  const drawn = renderDashboard(source, 'Signups')
  expect(drawn.html).toContain('As of <time datetime="2026-11-07T09:40:00.000Z">')
  expect(drawn.html).toContain('<strong>11</strong>')
  expect(drawn.html).toContain('<svg')
  expect(drawn.html).not.toContain('<script')
  expect(dashboardCsv(drawn.files[0]!.content)).toBe('day,plan,count\nMon,free,4\nMon,pro,1\nTue,free,6\nWed,free,\n')
})

it('writes CSV a spreadsheet cannot run as a formula', () => {
  const csv = dashboardCsv(
    JSON.stringify({
      datasets: [
        { id: 'a', columns: ['note'], rows: [['=HYPERLINK("x")'], ['a,b']] },
        { id: 'b', columns: ['n'], rows: [[1]] },
      ],
    }),
  )
  expect(csv).toBe(`a\nnote\n"'=HYPERLINK(""x"")"\n"a,b"\n\nb\nn\n1\n`)
})

it('takes a live table’s columns from its source and needs columns otherwise', () => {
  const live = parseArtifactSource({
    kind: 'dashboard',
    datasets: [{ id: 'deploys', source: 'deployments' }],
    figures: [{ label: 'Deploys', dataset: 'deploys', column: 'state', aggregate: 'count' }],
  })
  if (live.kind !== 'dashboard') throw new Error('not a dashboard')
  expect(live.datasets[0]!.columns).toEqual(['created', 'state', 'production', 'branch', 'message', 'url'])
  expect(() => parseArtifactSource({ kind: 'dashboard', datasets: [{ id: 'x', rows: [] }], figures: [] })).toThrow(
    'Give x its columns, or a source.',
  )
})

it('reads live tables again when opened, at most every five minutes, and only with a project', async () => {
  const source = parseArtifactSource({
    kind: 'dashboard',
    datasets: [{ id: 'usage', source: 'usage' }],
    figures: [{ label: 'Used', dataset: 'usage', column: 'used' }],
  })
  if (source.kind !== 'dashboard') throw new Error('not a dashboard')
  const published = renderDashboard(source, 'Costs')
  const document = {
    reference: { id: 'a', version: 1, kind: 'dashboard', title: 'Costs' },
    html: published.html,
    files: published.files,
  } as unknown as InteractiveDocument
  let now = Date.parse('2026-11-07T10:00:00Z')
  let used = 40
  const read = vi.fn<ReadDashboardSource>(async () => [['vercel', 'transfer', null, used, 100, 'bytes']])
  const live = new LiveDashboards(read, () => now)
  expect(await live.serve(document, null)).toBe(document)
  const first = await live.serve(document, 'p1')
  expect(first.html).toContain('<strong>40</strong>')
  expect(first.html).toContain('As of <time datetime="2026-11-07T10:00:00.000Z">')
  used = 55
  now += 60_000
  expect((await live.serve(document, 'p1')).html).toContain('<strong>40</strong>')
  now += 5 * 60_000
  expect((await live.serve(document, 'p1')).html).toContain('<strong>55</strong>')
  expect(read).toHaveBeenCalledTimes(2)
})

it('reads a table from a project file, by header or key, and refuses paths outside the project', async () => {
  const csv = 'Day,Count,Note\r\nMon,4,"first, ""big"" day"\nTue,,\n\nWed,6.5,x\n'
  expect(tableFromFile('data/s.csv', csv, ['day', 'count', 'missing'])).toEqual([
    ['Mon', 4, null],
    ['Tue', null, null],
    ['Wed', 6.5, null],
  ])
  expect(tableFromFile('data/s.csv', csv, ['note'])[0]).toEqual(['first, "big" day'])
  expect(tableFromFile('s.json', '[{"day":"Mon","count":"3"},{"day":true},7]', ['day', 'count'])).toEqual([
    ['Mon', 3],
    ['true', null],
  ])
  expect(() => tableFromFile('s.json', '{}', ['day'])).toThrow('not a JSON array')

  const table = { id: 'signups', file: 'data/s.csv', columns: ['day', 'count'] }
  const parsed = parseArtifactSource({
    kind: 'dashboard',
    datasets: [table],
    figures: [{ label: 'Signups', dataset: 'signups', column: 'count' }],
  })
  if (parsed.kind !== 'dashboard') throw new Error('not a dashboard')
  for (const file of ['../secrets.csv', '/etc/x.csv', 'data/s.txt'])
    expect(() =>
      parseArtifactSource({ kind: 'dashboard', datasets: [{ ...table, file }], figures: parsed.figures }),
    ).toThrow('inside the project')
  const drawn = renderDashboard(parsed, 'Signups')
  const document = {
    reference: { id: 'f', version: 1, kind: 'dashboard', title: 'Signups' },
    html: drawn.html,
    files: drawn.files,
  } as unknown as InteractiveDocument
  const read = vi.fn<ReadDashboardSource>(async (_project, { file, columns }) => tableFromFile(file!, csv, columns))
  expect((await new LiveDashboards(read).serve(document, 'p1')).html).toContain('<strong>10.5</strong>')
  expect(read).toHaveBeenCalledWith('p1', expect.objectContaining({ file: 'data/s.csv' }))
})

it('reads an App’s records as a live table, also for a dashboard in no project, and keeps other tables as published', async () => {
  const app = '00000000-0000-4000-8000-0000000000aa'
  const parsed = parseArtifactSource({
    kind: 'dashboard',
    datasets: [
      { id: 'spend', records: { artifact: app, collection: 'expenses' }, columns: ['category', 'amount'] },
      { id: 'deploys', source: 'deployments' },
    ],
    figures: [{ label: 'Spent', dataset: 'spend', column: 'amount' }],
  })
  if (parsed.kind !== 'dashboard') throw new Error('not a dashboard')
  expect(() =>
    parseArtifactSource({
      kind: 'dashboard',
      datasets: [{ id: 'x', records: { artifact: app, collection: 'e' }, file: 'a.csv', columns: ['a'] }],
      figures: [{ label: 'A', dataset: 'x', column: 'a', aggregate: 'count' }],
    }),
  ).toThrow('one of a source, a file, records or an MCP tool')
  const drawn = renderDashboard(parsed, 'Spending')
  const document = {
    reference: { id: 'r', version: 1, kind: 'dashboard', title: 'Spending' },
    html: drawn.html,
    files: drawn.files,
  } as unknown as InteractiveDocument
  const read = vi.fn<ReadDashboardSource>(async (_project, table) =>
    table.records
      ? [
          ['food', 30],
          ['rent', 70],
        ]
      : [],
  )
  expect((await new LiveDashboards(read).serve(document, null)).html).toContain('<strong>100</strong>')
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledWith(
    null,
    expect.objectContaining({ records: { artifact: app, collection: 'expenses' } }),
  )
})

it('takes the columns of the threads, pull requests and activity sources, and reads activity without a project', async () => {
  const parsed = parseArtifactSource({
    kind: 'dashboard',
    datasets: [
      { id: 'threads', source: 'threads' },
      { id: 'prs', source: 'pullRequests' },
      { id: 'work', source: 'activity' },
    ],
    figures: [
      { label: 'Done', dataset: 'threads', column: 'done' },
      { label: 'Cost', dataset: 'work', column: 'cost', unit: ' USD' },
    ],
    charts: [{ title: 'Turns', type: 'bar', dataset: 'work', x: 'provider', y: ['turns'] }],
  })
  if (parsed.kind !== 'dashboard') throw new Error('not a dashboard')
  expect(parsed.datasets.map((table) => table.columns)).toEqual([
    ['title', 'status', 'done', 'lastActive'],
    ['thread', 'number', 'title', 'state', 'stage', 'url'],
    ['day', 'provider', 'turns', 'cost', 'tokens'],
  ])
  const drawn = renderDashboard(parsed, 'Work')
  const document = {
    reference: { id: 'w', version: 1, kind: 'dashboard', title: 'Work' },
    html: drawn.html,
    files: drawn.files,
  } as unknown as InteractiveDocument
  const read = vi.fn<ReadDashboardSource>(async (_project, table) =>
    table.source === 'activity' ? [['2026-11-06', 'claude', 4, 1.5, 9000]] : [],
  )
  expect((await new LiveDashboards(read).serve(document, null)).html).toContain('<strong>1.5 USD</strong>')
  expect(read.mock.calls.map((call) => call[1].source)).toEqual(['activity'])
})

it('reads a table from a Shared MCP tool on open, only with a project', async () => {
  const parsed = parseArtifactSource({
    kind: 'dashboard',
    datasets: [
      {
        id: 'signups',
        mcp: { server: 'analytics', tool: 'signups_by_day', arguments: { days: 7 } },
        columns: ['day', 'count'],
      },
    ],
    figures: [{ label: 'Signups', dataset: 'signups', column: 'count' }],
  })
  if (parsed.kind !== 'dashboard') throw new Error('not a dashboard')
  const drawn = renderDashboard(parsed, 'Growth')
  const document = {
    reference: { id: 'm', version: 1, kind: 'dashboard', title: 'Growth' },
    html: drawn.html,
    files: drawn.files,
  } as unknown as InteractiveDocument
  const read = vi.fn<ReadDashboardSource>(async () => [
    ['Mon', 4],
    ['Tue', 6],
  ])
  const live = new LiveDashboards(read)
  expect(await live.serve(document, null)).toBe(document)
  expect((await live.serve(document, 'p1')).html).toContain('<strong>10</strong>')
  expect(read).toHaveBeenCalledWith(
    'p1',
    expect.objectContaining({ mcp: { server: 'analytics', tool: 'signups_by_day', arguments: { days: 7 } } }),
  )
})

it('cuts dated tables to the dashboard’s range when drawn, leaving undated ones whole', () => {
  const parsed = parseArtifactSource({
    kind: 'dashboard',
    rangeDays: 7,
    datasets: [
      {
        id: 'daily',
        columns: ['day', 'signups'],
        rows: [
          ['2026-10-01', 100],
          ['2026-11-02', 3],
          ['2026-11-06T12:00:00Z', 4],
        ],
      },
      { id: 'plans', columns: ['plan', 'count'], rows: [['free', 9]] },
      { id: 'deploys', source: 'deployments' },
    ],
    figures: [
      { label: 'Signups', dataset: 'daily', column: 'signups' },
      { label: 'Plans', dataset: 'plans', column: 'count' },
    ],
  })
  if (parsed.kind !== 'dashboard') throw new Error('not a dashboard')
  const drawn = renderDashboard(parsed, 'Growth', Date.parse('2026-11-07T00:00:00Z'))
  expect(drawn.html).toContain('<span>Signups</span><strong>7</strong>')
  expect(drawn.html).toContain('<span>Plans</span><strong>9</strong>')
  expect(drawn.html).toContain(' · last 7 days</p>')
  expect(JSON.parse(drawn.files[0]!.content)).toMatchObject({ rangeDays: 7 })
  expect(JSON.parse(drawn.files[0]!.content).datasets[0].rows).toHaveLength(3)
})

it('tells the person’s devices when a watched figure changes, remembering values between rounds', async () => {
  const source = parseArtifactSource({
    kind: 'dashboard',
    datasets: [{ id: 'usage', source: 'usage' }],
    figures: [
      { label: 'Used', dataset: 'usage', column: 'used', notify: true, unit: ' GB' },
      { label: 'Rows', dataset: 'usage', column: 'used', aggregate: 'count' },
    ],
  })
  if (source.kind !== 'dashboard') throw new Error('not a dashboard')
  const drawn = renderDashboard(source, 'Costs')
  const document = {
    reference: { id: 'a', version: 1, kind: 'dashboard', title: 'Costs' },
    html: drawn.html,
    files: drawn.files,
  } as unknown as InteractiveDocument
  let used = 40
  const live = new LiveDashboards(async () => [['vercel', 'transfer', null, used, 100, 'GB']])
  let memory = {}
  let now = 0
  const notify = vi.fn()
  const round = () =>
    watchDashboards({
      now: () => (now += 6 * 60_000),
      dashboards: () => [{ id: 'a', title: 'Costs', projectId: 'p1' }],
      document: () => document,
      live,
      memory: { read: () => memory, write: (values) => void (memory = values) },
      notify,
    })
  await round()
  expect(notify).not.toHaveBeenCalled()
  used = 55
  await round()
  expect(notify).toHaveBeenCalledWith('a', 'Used: 40 GB → 55 GB')
  await round()
  expect(notify).toHaveBeenCalledTimes(1)
})

it('reads a dashboard again only as often as its refresh rule says', async () => {
  const source = parseArtifactSource({
    kind: 'dashboard',
    datasets: [{ id: 'usage', source: 'usage' }],
    figures: [{ label: 'Used', dataset: 'usage', column: 'used', notify: true }],
    refreshMinutes: 60,
  })
  if (source.kind !== 'dashboard') throw new Error('not a dashboard')
  const drawn = renderDashboard(source, 'Costs')
  const document = {
    reference: { id: 'a', version: 1, kind: 'dashboard', title: 'Costs' },
    html: drawn.html,
    files: drawn.files,
  } as unknown as InteractiveDocument
  expect(refreshMs(document)).toBe(60 * 60_000)
  const read = vi.fn<ReadDashboardSource>(async () => [['vercel', 'transfer', null, 1, 100, 'GB']])
  const live = new LiveDashboards(read)
  let memory = {}
  let now = 0
  const round = () =>
    watchDashboards({
      now: () => (now += 10 * 60_000),
      dashboards: () => [{ id: 'a', title: 'Costs', projectId: 'p1' }],
      document: () => document,
      live,
      memory: { read: () => memory, write: (values) => void (memory = values) },
      notify: () => {},
    })
  for (let i = 0; i < 6; i++) await round()
  expect(read).toHaveBeenCalledTimes(1)
  await round()
  expect(read).toHaveBeenCalledTimes(2)
})
