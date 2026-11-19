import { describe, expect, it } from 'vitest'
import type { AgentSessionInfo, Task } from '@ramu/shared/types'
import { groupOf } from '../src/agentGroups'

const session = (patch: Partial<AgentSessionInfo> = {}) => ({ state: 'idle', ...patch }) as AgentSessionInfo
const task = (goalStatus?: string) =>
  ({ goalState: goalStatus ? { status: goalStatus, objective: 'Ship it' } : null }) as unknown as Task

describe('Home groups', () => {
  it('keeps a thread with an active goal among running work between turns', () => {
    expect(groupOf(session(), task('active'))).toBe('Running')
  })

  it('does not treat a paused, blocked or capped goal, or a helper, as running', () => {
    for (const status of ['paused', 'blocked', 'turn-limit'])
      expect(groupOf(session(), task(status))).toBe('Waiting for your input')
    expect(groupOf(session({ parentId: 'p' } as never), task('active'))).toBe('Done')
  })

  it('still puts a waiting request and a usage limit first', () => {
    expect(groupOf(session({ state: 'needs-input' }), task('active'))).toBe('Waiting for your input')
    expect(groupOf(session({ waitingUntil: 5 } as never), task('active'))).toBe('Limit reached')
    expect(
      groupOf(session(), {
        ...task('paused'),
        goalState: { status: 'paused', pausedBy: 'provider-limit', objective: 'Continue' },
      }),
    ).toBe('Limit reached')
  })

  it('keeps a thread among running work while its independent helpers run, like the finished-thread gate', () => {
    const withHelpers = (active: number) =>
      ({ helperSummary: { active, waiting: 0 }, goalState: null }) as unknown as Task
    expect(groupOf(session(), withHelpers(2))).toBe('Running')
    expect(groupOf(session(), withHelpers(0))).toBe('Done')
    // A helper's own row never counts its parent's helpers, and a request or limit still comes first.
    expect(groupOf(session({ parentId: 'p' } as never), withHelpers(2))).toBe('Done')
    expect(groupOf(session({ state: 'needs-input' }), withHelpers(2))).toBe('Waiting for your input')
    expect(groupOf(session({ waitingUntil: 5 } as never), withHelpers(2))).toBe('Limit reached')
  })
})
