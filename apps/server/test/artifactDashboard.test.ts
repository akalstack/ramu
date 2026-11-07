import { expect, it, vi } from 'vitest'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { LiveDashboards, watchDashboards, type ReadDashboardSource } from '../src/interactive/liveDashboard'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { dashboardCsv } from '@ramu/shared/interactiveExport'
import { aggregate, dashboardChart, renderDashboard } from '../src/interactive/dashboard'

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
  const notify = vi.fn()
  const round = () =>
    watchDashboards({
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
