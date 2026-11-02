import type { ChatGoal, GoalPausedBy } from '../types'

/**
 * A goal held back from continuing, and by whom. `paused` with `pausedBy: 'provider-limit'` is a provider's usage limit
 * (it resumes by itself at the reset, and is never a stall or a failure); any other paused goal is the user's, and never
 * resumes by itself.
 */
export function goalHold(goal: Pick<ChatGoal, 'status' | 'pausedBy'> | null | undefined): GoalPausedBy | null {
  if (!goal) return null
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
export type GoalState = ChatGoal['status'] | 'limit'

export const goalState = (goal: Pick<ChatGoal, 'status' | 'pausedBy'>): GoalState =>
  isLimitHold(goal) ? 'limit' : (goal.status as GoalState)
