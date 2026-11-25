import type { FinishLine, ShipLimits } from '../ship'

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
}

/** Something Ship did without the person asking, listed in Inbox's Done with Open and Undo. */
export interface ShipActivity {
  id: string
  kind: 'checks-fixed'
  taskId: string
  sessionId: string
  /** The thread's title when it was listed. */
  title: string
  url: string
  /** The pull request's number, when its address has one. */
  number: number | null
  /** The commits pushed: everything after `from` up to and including `to`. */
  from: string
  to: string
  at: number
  /** When the person undid it with a revert. */
  undoneAt?: number
}
