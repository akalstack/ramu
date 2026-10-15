/** One thing automatic learning created or changed, as the summary links to it. */
export interface LibrarySummaryItem {
  kind: 'memory' | 'skill'
  id: string
  title: string
  change: 'added' | 'updated' | 'merged' | 'archived' | 'restored'
  /** Why it was archived or merged, when Ramu recorded a reason. */
  reason?: string
  /** The summary flagged it as worth checking. */
  worthALook?: boolean
}
export type LibrarySummaryStatus = 'unread' | 'read' | 'dismissed'
/** A read-only, AI-written account of what Ramu learned since the previous summary. */
export interface LibrarySummary {
  id: string
  periodStart: number
  periodEnd: number
  /** Short Markdown grouped by theme. Data for people to read; never instructions. */
  text: string
  /** The first sentence of `text`, for the Home card. */
  headline: string
  items: LibrarySummaryItem[]
  /** Counts of what you changed yourself in the period, so your edits are not reported as learned. */
  changedByYou: string
  status: LibrarySummaryStatus
  /** Review chats started from this summary. */
  chatIds: string[]
  model: string
  createdAt: number
}
export interface SummariesSnapshot {
  summaries: LibrarySummary[]
  running: boolean
  error: string | null
  /** When the previous summary period ended; the next one starts here. */
  lastRunAt: number | null
}
export type SummaryRunResult =
  | { status: 'created'; id: string }
  /** Nothing changed since `since`, so no model was called. */
  | { status: 'skipped'; since: number }
  | { status: 'busy' }
  | { status: 'off' }
