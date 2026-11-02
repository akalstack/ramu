import { expect, it } from 'vitest'
import { goalContinues, goalHold, goalState, isLimitHold } from '../src/chat/goalHold'
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
  // A missing reason means the user.
  expect(goalHold(goal({ status: 'paused' }))).toBe('user')
  expect(goalHold(goal())).toBeNull()
  expect(goalHold(goal({ status: 'blocked' }))).toBeNull()
  expect(goalHold(null)).toBeNull()
  expect(goalHold(undefined)).toBeNull()
})

it('keeps working an active goal and a limit hold, never a user pause', () => {
  expect(goalContinues(goal())).toBe(true)
  expect(goalContinues(goal({ status: 'paused', pausedBy: 'provider-limit' }))).toBe(true)
  expect(goalContinues(goal({ status: 'paused', pausedBy: 'user' }))).toBe(false)
  expect(goalContinues(goal({ status: 'paused' }))).toBe(false)
  for (const status of ['blocked', 'completed', 'turn-limit'] as const)
    expect(goalContinues(goal({ status }))).toBe(false)
  expect(goalContinues(null)).toBe(false)
  expect(isLimitHold(goal({ status: 'paused' }))).toBe(false)
})

it('names one state per goal, so the two paused kinds are labelled apart', () => {
  expect(goalState(goal({ status: 'paused', pausedBy: 'provider-limit' }))).toBe('limit')
  expect(goalState(goal({ status: 'paused' }))).toBe('paused')
  expect(goalState(goal({ status: 'turn-limit' }))).toBe('turn-limit')
})
