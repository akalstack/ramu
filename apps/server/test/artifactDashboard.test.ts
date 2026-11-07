import { expect, it } from 'vitest'
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
