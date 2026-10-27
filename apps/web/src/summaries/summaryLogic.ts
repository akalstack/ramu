import type { IntelligencePreferences, LibrarySummary, LibrarySummaryItem, SummaryRunResult } from '@ramu/shared/types'

/** The summary view's "nothing to change" button, which dismisses the summary. Kept in one place so it is easy to rename. */
export const DISMISS_LABEL = 'Looks good'

export const SUMMARY_INTERVAL_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 } as const

/** Summaries still worth showing: dismissed ones live on only in the history list. */
export const activeSummaries = (summaries: LibrarySummary[]): LibrarySummary[] =>
  summaries.filter((summary) => summary.status !== 'dismissed')

export const unreadCount = (summaries: LibrarySummary[]): number =>
  summaries.filter((summary) => summary.status === 'unread').length

/** When the next summary is due, or null while summaries are off or have not started. */
export function nextSummaryAt(
  interval: IntelligencePreferences['summaryInterval'],
  lastRunAt: number | null,
): number | null {
  return interval === 'off' || lastRunAt === null ? null : lastRunAt + SUMMARY_INTERVAL_MS[interval]
}

const THEME_ORDER = ['added', 'updated', 'merged', 'archived', 'restored'] as const
export const CHANGE_LABELS: Record<LibrarySummaryItem['change'], string> = {
  added: 'Added',
  updated: 'Updated',
  merged: 'Merged',
  archived: 'Archived',
  restored: 'Restored',
}

/** Items grouped by what happened to them, in a stable order, flagged ones first within a group. */
export function groupItems(
  items: LibrarySummaryItem[],
): { change: LibrarySummaryItem['change']; items: LibrarySummaryItem[] }[] {
  return THEME_ORDER.map((change) => ({
    change,
    items: items
      .filter((item) => item.change === change)
      .sort((a, b) => Number(!!b.worthALook) - Number(!!a.worthALook)),
  })).filter((group) => group.items.length)
}

/** One-line message for the result of "Run now". */
export function runMessage(
  result: SummaryRunResult,
  formatDate: (at: number) => string,
  translate: (source: string, values?: Record<string, string | number>) => string = (source, values) =>
    source.replace(/\{(\w+)\}/g, (_m, key: string) => String(values?.[key] ?? '')),
): string | null {
  switch (result.status) {
    case 'skipped':
      return translate('Nothing new since {0}', { 0: formatDate(result.since) })
    case 'busy':
      return translate('Ramu is busy right now. Try again when your threads have finished.')
    case 'off':
      return translate('Turn summaries on first.')
    case 'created':
      return null
  }
}
