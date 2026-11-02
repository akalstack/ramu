export interface GoalPreferences {
  mode: 'auto' | 'manual'
  /** Automatic follow-up turns per goal; null means unlimited. Initial and user turns do not count. */
  maxTurns: number | null
}
export const DEFAULT_GOAL_PREFERENCES: GoalPreferences = { mode: 'auto', maxTurns: 10 }
/** What the agent reports when it declares a goal complete: each check it ran and the files it changed. */
export interface GoalEvidence {
  checks: { name: string; passed: boolean; output?: string }[]
  /** Files the agent changed. Every uncommitted change made during the goal must appear here or in `otherChanges`. */
  changedFiles: string[]
  /** Uncommitted files the agent did not change (the user's, another thread's). */
  otherChanges?: string[]
}
/** The result of the goal's verification command, run by Ramu after a completion claim. */
export interface GoalCheck {
  command: string
  ok: boolean
  /** The exit code; null when the command could not run or was ended by the time limit. */
  code?: number | null
  timedOut?: boolean
  /** The end of the combined output, with credentials removed. */
  output: string
  at: number
  /** Set once the output has been sent to the agent as a continuation, so it is not repeated. */
  delivered?: boolean
}
/** Who holds a paused goal: the user (it never resumes by itself) or a provider's usage limit (it resumes at the reset). */
export type GoalPausedBy = 'user' | 'provider-limit'
export interface ChatGoal {
  id: string
  objective: string
  /**
   * `paused` covers both holds; `pausedBy` tells them apart. `waiting-provider` is the retired status for a limit hold:
   * hosts and caches from before the merge still send it, so readers accept it (see `goalHold`), and Ramu never writes it.
   */
  status: 'active' | 'completed' | 'blocked' | 'paused' | 'turn-limit' | 'waiting-provider'
  /** Only meaningful while `status` is `paused`. Absent means the user paused it, which is what every older paused goal was. */
  pausedBy?: GoalPausedBy
  turns: number
  reason: string
  updatedAt: number
  retryAt?: number
  retryDelay?: number
  /** A command the user set. When the agent claims completion Ramu runs it in the workspace; only a pass completes the goal. */
  verify?: string
  /** The evidence the agent gave; kept on a completed goal. */
  evidence?: GoalEvidence
  /** A completion claim waiting for the verification command to run after the agent's turn ends. */
  claim?: {
    reason: string
    evidence: GoalEvidence
    at: number
    /** Fingerprint of instruction/request events when evidence was accepted; survives restart. Absent on older claims. */
    inputState?: string
  }
  /** The latest verification run. A failure is sent to the agent with the next continuation. */
  check?: GoalCheck
  /** Stall detection: what the last continuation left behind, and how many continuations in a row left the same. */
  stall?: { fingerprint: string; unchanged: number; seq: number }
}
