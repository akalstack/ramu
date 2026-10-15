export interface GoalPreferences {
  mode: 'auto' | 'manual'
  /** Automatic follow-up turns per goal; null means unlimited. Initial and user turns do not count. */
  maxTurns: number | null
}
export const DEFAULT_GOAL_PREFERENCES: GoalPreferences = { mode: 'auto', maxTurns: 10 }
export interface ChatGoal {
  id: string
  objective: string
  status: 'active' | 'completed' | 'blocked' | 'paused' | 'turn-limit' | 'waiting-provider'
  turns: number
  reason: string
  updatedAt: number
  retryAt?: number
  retryDelay?: number
}
