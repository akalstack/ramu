import type { FinishLine, ShipLimits, ShipOptions } from '../ship'

/** A project's Ship settings as its menu shows them. */
export interface ShipProjectStatus {
  /** The person's choice for this project on this host; null follows the suggestion. */
  chosen: FinishLine | null
  /** What Ramu suggests from the repository: review for a team's, further for a personal one. */
  suggested: FinishLine
  /** The earliest finish line the repositories' committed `ramu.json` allows; null sets no limit. */
  repositoryLimit: FinishLine | null
  /** Where shipping stops: the choice or suggestion, held to the repository's limit. */
  finishLine: FinishLine
  limits: ShipLimits
  /** What Ship may do here without asking, after the person's choices and the repository's limits. */
  options: ShipOptions
  /** Options the repositories' committed `ramu.json` turns off; the person cannot turn these on. */
  forbidden: (keyof ShipOptions)[]
  /** The project's first production deploy was allowed, so `autoDeploy` now applies. */
  deployedOnce: boolean
}

/** Something Ship did without the person asking, listed in Inbox's Done with Open and Undo. */
export interface ShipActivity {
  id: string
  /** A fix pushed for failing checks, or replies posted to reviewers after a review round. */
  kind: 'checks-fixed' | 'replies-sent'
  taskId: string
  sessionId: string
  /** The thread's title when it was listed. */
  title: string
  url: string
  /** The pull request's number, when its address has one. */
  number: number | null
  /** A pushed fix's commits: everything after `from` up to and including `to`. */
  from?: string
  to?: string
  /** How many replies were posted. */
  replies?: number
  at: number
  /** When the person undid it with a revert. */
  undoneAt?: number
}
