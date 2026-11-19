import { describe, expect, it } from 'vitest'
import { delayedStatusDeadline, shownDelayedStatus, stepDelayedStatus } from '../src/chat/delayedStatus'

describe('delayed status', () => {
  it('never shows a sync that finishes quickly', () => {
    const started = stepDelayedStatus(null, 'a', 'syncing', 0)
    expect(shownDelayedStatus(started)).toBeNull()
    const finished = stepDelayedStatus(started, 'a', null, 300)
    expect(shownDelayedStatus(stepDelayedStatus(finished, 'a', null, 1000))).toBeNull()
  })

  it('shows a slow sync after the delay and keeps it up briefly once it ends', () => {
    const started = stepDelayedStatus(null, 'a', 'syncing', 0)
    expect(delayedStatusDeadline(started)).toBe(400)
    const shown = stepDelayedStatus(started, 'a', 'syncing', 400)
    expect(shownDelayedStatus(shown)).toBe('syncing')
    const ended = stepDelayedStatus(shown, 'a', null, 500)
    expect(shownDelayedStatus(ended)).toBe('syncing')
    expect(shownDelayedStatus(stepDelayedStatus(ended, 'a', null, 800))).toBeNull()
  })

  it('returns the same state when nothing changes', () => {
    const started = stepDelayedStatus(null, 'a', 'syncing', 0)
    expect(stepDelayedStatus(started, 'a', 'syncing', 100)).toBe(started)
    const idle = stepDelayedStatus(null, 'a', null, 0)
    expect(stepDelayedStatus(idle, 'a', null, 5000)).toBe(idle)
  })

  it('starts over in another thread instead of carrying the status across', () => {
    const shown = stepDelayedStatus(stepDelayedStatus(null, 'a', 'syncing', 0), 'a', 'syncing', 400)
    const other = stepDelayedStatus(shown, 'b', 'syncing', 450)
    expect(shownDelayedStatus(other)).toBeNull()
    expect(shownDelayedStatus(stepDelayedStatus(shown, 'b', null, 450))).toBeNull()
  })
})
