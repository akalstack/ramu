// A dashboard's two settings a person changes without the agent: how often its live tables are read again, and how far
// back its dated rows go. Shared so the desktop and the phone offer the same choices with the same words.
import type { TranslationValues } from './i18n'
import { dashboardTimeColumn, type DashboardSourceKind } from './artifactSource'

export const DASHBOARD_RANGE_CHOICES = [null, 7, 30, 90, 365] as const
export type DashboardRange = (typeof DASHBOARD_RANGE_CHOICES)[number]
export const DASHBOARD_REFRESH_CHOICES = [5, 15, 60, 360, 1440] as const

type Say = (text: string, values?: TranslationValues) => string

export const dashboardRangeLabel = (days: number | null, say: Say) =>
  days === null ? say('All time') : days === 365 ? say('Last year') : say('Last {count} days', { count: days })

export function dashboardRefreshLabel(minutes: number, say: Say): string {
  const known: Record<number, string> = {
    5: 'Every 5 minutes',
    15: 'Every 15 minutes',
    60: 'Every hour',
    360: 'Every 6 hours',
    1440: 'Once a day',
  }
  return known[minutes] ? say(known[minutes]) : say('Every {count} minutes', { count: minutes })
}

interface BoardTable {
  columns: string[]
  rows: (string | number | null)[][]
  source?: DashboardSourceKind
  file?: string
  records?: object
  mcp?: object
}

/**
 * What a dashboard's source offers: its refresh interval when it has live tables (five minutes unless set), and
 * whether it can be cut to a range (a live table, or a table with a date column), with the current range.
 */
export function dashboardControls(source: string | undefined): {
  refresh: number | null
  ranged: boolean
  rangeDays: number | null
} {
  if (!source) return { refresh: null, ranged: false, rangeDays: null }
  let board: { datasets?: BoardTable[]; refreshMinutes?: number; rangeDays?: number }
  try {
    board = JSON.parse(source) as typeof board
  } catch {
    return { refresh: null, ranged: false, rangeDays: null }
  }
  const tables = Array.isArray(board.datasets) ? board.datasets : []
  return {
    refresh: tables.some((table) => table.source || table.file || table.records || table.mcp)
      ? (board.refreshMinutes ?? 5)
      : null,
    ranged: tables.some((table) => table.file || table.records || table.mcp || dashboardTimeColumn(table) >= 0),
    rangeDays: typeof board.rangeDays === 'number' ? board.rangeDays : null,
  }
}
