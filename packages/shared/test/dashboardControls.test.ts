import { expect, it } from 'vitest'
import { dashboardControls, dashboardRangeLabel, dashboardRefreshLabel } from '../src/dashboardControls'

const say = (text: string, values: Record<string, unknown> = {}) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))

it('offers refresh only for live tables and a range for dated or live ones', () => {
  const fixed = JSON.stringify({ datasets: [{ columns: ['name'], rows: [['a']] }] })
  expect(dashboardControls(fixed)).toEqual({ refresh: null, ranged: false, rangeDays: null })
  const dated = JSON.stringify({ datasets: [{ columns: ['day'], rows: [['2026-01-02']] }], rangeDays: 30 })
  expect(dashboardControls(dated)).toEqual({ refresh: null, ranged: true, rangeDays: 30 })
  const live = JSON.stringify({ datasets: [{ columns: [], rows: [], file: 'x.csv' }], refreshMinutes: 60 })
  expect(dashboardControls(live)).toEqual({ refresh: 60, ranged: true, rangeDays: null })
  expect(dashboardControls('{broken')).toEqual({ refresh: null, ranged: false, rangeDays: null })
  expect(dashboardControls(undefined).refresh).toBeNull()
})

it('names each choice the same way on every device', () => {
  expect(dashboardRefreshLabel(5, say)).toBe('Every 5 minutes')
  expect(dashboardRefreshLabel(45, say)).toBe('Every 45 minutes')
  expect(dashboardRangeLabel(null, say)).toBe('All time')
  expect(dashboardRangeLabel(365, say)).toBe('Last year')
  expect(dashboardRangeLabel(30, say)).toBe('Last 30 days')
})
