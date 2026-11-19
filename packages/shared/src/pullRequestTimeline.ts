import type { PullRequestTimelineEvent } from './types'

/** What each timeline event says after its actor, as English copy keys. */
export const TIMELINE_SAID: Record<PullRequestTimelineEvent['kind'], string> = {
  commit: 'committed',
  review: 'reviewed',
  comment: 'commented',
  'review-requested': 'asked for a review from {0}',
  'force-pushed': 'force-pushed the branch',
  ready: 'marked it ready for review',
  merged: 'merged it',
  closed: 'closed it',
  reopened: 'reopened it',
}

export const TIMELINE_VERDICT: Record<NonNullable<PullRequestTimelineEvent['verdict']>, string> = {
  approved: 'approved',
  'changes-requested': 'requested changes',
  commented: 'reviewed',
  dismissed: 'had a review dismissed',
}

/** Rows shown before the older history is asked for; the newest are what changed since the last look. */
export const TIMELINE_RECENT = 8

export type TimelineEntry =
  | { kind: 'event'; event: PullRequestTimelineEvent }
  | { kind: 'commits'; actor: PullRequestTimelineEvent['actor']; events: PullRequestTimelineEvent[] }

/** Consecutive commits by one person read as one push, as the services show them. */
export function timelineEntries(events: PullRequestTimelineEvent[]): TimelineEntry[] {
  const result: TimelineEntry[] = []
  for (const event of events) {
    const last = result.at(-1)
    if (event.kind === 'commit' && last?.kind === 'commits' && last.actor === event.actor) last.events.push(event)
    else if (event.kind === 'commit') result.push({ kind: 'commits', actor: event.actor, events: [event] })
    else result.push({ kind: 'event', event })
  }
  return result
}
