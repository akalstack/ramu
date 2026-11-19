import { describe, expect, it } from 'vitest'
import { isStaleProgress, latestTasks } from '../src/chat/agentTasks'

describe('isStaleProgress', () => {
  it('rejects running progress after a helper ended, unless it resumed later', () => {
    const ended = { status: 'stopped' as const, endedAt: 100 }
    expect(isStaleProgress(ended, { status: 'running' })).toBe(true)
    expect(isStaleProgress(ended, { status: 'running', resumedAt: 100 })).toBe(true)
    expect(isStaleProgress(ended, { status: 'running', resumedAt: 101 })).toBe(false)
  })

  it('accepts everything else', () => {
    expect(isStaleProgress(undefined, { status: 'running' })).toBe(false)
    expect(isStaleProgress({ status: 'running' }, { status: 'running' })).toBe(false)
    expect(isStaleProgress({ status: 'stopped', endedAt: 5 }, { status: 'failed' })).toBe(false)
  })

  it('keeps a stopped helper stopped in the transcript fold', () => {
    const events = [
      { kind: 'agent', agentId: 'a', name: 'A', status: 'running' },
      { kind: 'agent', agentId: 'a', name: 'A', status: 'stopped', endedAt: 10 },
      { kind: 'agent', agentId: 'a', name: 'Late', status: 'running' },
    ] as never
    expect(latestTasks(events).map((task) => task.status)).toEqual(['stopped'])
  })
})
