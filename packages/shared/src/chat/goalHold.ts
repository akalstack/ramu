import type { ChatGoal, GoalPausedBy } from '../types'

/**
 * A goal held back from continuing, and by whom. `paused` with `pausedBy: 'provider-limit'` is a provider's usage limit
 * (it resumes by itself at the reset, and is never a stall or a failure); any other paused goal is the user's, and never
 * resumes by itself. The retired `waiting-provider` status, still sent by older hosts, reads as a limit hold.
 */
export function goalHold(goal: Pick<ChatGoal, 'status' | 'pausedBy'> | null | undefined): GoalPausedBy | null {
  if (!goal) return null
  if (goal.status === 'waiting-provider') return 'provider-limit'
  if (goal.status !== 'paused') return null
  return goal.pausedBy === 'provider-limit' ? 'provider-limit' : 'user'
}

/** Held at a provider's usage limit; Ramu continues it when the limit resets. */
export const isLimitHold = (goal: Pick<ChatGoal, 'status' | 'pausedBy'> | null | undefined) =>
  goalHold(goal) === 'provider-limit'

/** Paused by the user: it stays paused until they resume it. */
export const isUserPaused = (goal: Pick<ChatGoal, 'status' | 'pausedBy'> | null | undefined) =>
  goalHold(goal) === 'user'

/** Ramu keeps working this goal: it is active, or waiting out a usage limit. */
export const goalContinues = (goal: Pick<ChatGoal, 'status' | 'pausedBy'> | null | undefined) =>
  goal?.status === 'active' || isLimitHold(goal)

/** What the goal is doing, as one value: a limit hold and a user pause are different states with the same status. */
export type GoalState = Exclude<ChatGoal['status'], 'waiting-provider'> | 'limit'

export const goalState = (goal: Pick<ChatGoal, 'status' | 'pausedBy'>): GoalState =>
  isLimitHold(goal) ? 'limit' : (goal.status as GoalState)

/** The goal in its current shape: the retired `waiting-provider` status becomes a limit hold. Other goals are returned as they are. */
export function normalizeGoal<T extends ChatGoal | null | undefined>(goal: T): T {
  if (!goal || goal.status !== 'waiting-provider') return goal
  return { ...goal, status: 'paused', pausedBy: 'provider-limit' }
}
