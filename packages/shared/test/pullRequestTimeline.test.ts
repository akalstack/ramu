import { describe, expect, it } from 'vitest'
import type { PullRequestTimelineEvent } from '../src/types'
import { timelineEntries } from '../src/pullRequestTimeline'

const event = (kind: PullRequestTimelineEvent['kind'], actor: string, at: number) =>
  ({ kind, actor, at }) as PullRequestTimelineEvent

describe('timeline entries', () => {
  it('reads consecutive commits by one person as one push, and keeps other events apart', () => {
    const rows = timelineEntries([
      event('commit', 'ana', 1),
      event('commit', 'ana', 2),
      event('commit', 'bo', 3),
      event('comment', 'ana', 4),
      event('commit', 'ana', 5),
    ])
    expect(
      rows.map((row) => (row.kind === 'commits' ? `commits:${row.actor}:${row.events.length}` : row.kind)),
    ).toEqual(['commits:ana:2', 'commits:bo:1', 'event', 'commits:ana:1'])
  })
})
