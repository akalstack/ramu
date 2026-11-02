import { expect, it } from 'vitest'
import { goalContinues, goalHold, goalState, isLimitHold, isUserPaused, normalizeGoal } from '../src/chat/goalHold'
import type { ChatGoal } from '../src/types'

const goal = (patch: Partial<ChatGoal> = {}): ChatGoal => ({
  id: 'g1',
  objective: 'Ship it',
  status: 'active',
  turns: 0,
  reason: '',
  updatedAt: 1,
  ...patch,
})

it('tells a limit hold from a user pause by who holds the paused goal', () => {
  expect(goalHold(goal({ status: 'paused', pausedBy: 'provider-limit' }))).toBe('provider-limit')
  expect(goalHold(goal({ status: 'paused', pausedBy: 'user' }))).toBe('user')
  // Every goal paused before the merge was the user's, so a missing reason means the user.
  expect(goalHold(goal({ status: 'paused' }))).toBe('user')
  // The retired status, still sent by older hosts, is a limit hold.
  expect(goalHold(goal({ status: 'waiting-provider' }))).toBe('provider-limit')
  expect(goalHold(goal())).toBeNull()
  expect(goalHold(goal({ status: 'blocked' }))).toBeNull()
  expect(goalHold(null)).toBeNull()
  expect(goalHold(undefined)).toBeNull()
})

it('keeps working an active goal and a limit hold, never a user pause', () => {
  expect(goalContinues(goal())).toBe(true)
  expect(goalContinues(goal({ status: 'paused', pausedBy: 'provider-limit' }))).toBe(true)
  expect(goalContinues(goal({ status: 'waiting-provider' }))).toBe(true)
  expect(goalContinues(goal({ status: 'paused', pausedBy: 'user' }))).toBe(false)
  expect(goalContinues(goal({ status: 'paused' }))).toBe(false)
  for (const status of ['blocked', 'completed', 'turn-limit'] as const)
    expect(goalContinues(goal({ status }))).toBe(false)
  expect(goalContinues(null)).toBe(false)
  expect(isLimitHold(goal({ status: 'paused' }))).toBe(false)
  expect(isUserPaused(goal({ status: 'waiting-provider' }))).toBe(false)
})

it('names one state per goal, so the two paused kinds are labelled apart', () => {
  expect(goalState(goal({ status: 'paused', pausedBy: 'provider-limit' }))).toBe('limit')
  expect(goalState(goal({ status: 'waiting-provider' }))).toBe('limit')
  expect(goalState(goal({ status: 'paused' }))).toBe('paused')
  expect(goalState(goal({ status: 'turn-limit' }))).toBe('turn-limit')
})

it('rewrites only the retired status and leaves every other goal as it is', () => {
  const old = goal({ status: 'waiting-provider', retryAt: 5 })
  expect(normalizeGoal(old)).toEqual({ ...old, status: 'paused', pausedBy: 'provider-limit' })
  expect(old.status).toBe('waiting-provider')
  const paused = goal({ status: 'paused' })
  expect(normalizeGoal(paused)).toBe(paused)
  expect(normalizeGoal(null)).toBeNull()
})
