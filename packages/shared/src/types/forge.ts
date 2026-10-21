// Pull requests and issues on the repository's hosting service (GitHub through the `gh` CLI).

/** Why forge features are unavailable for a checkout, or `ready` when they work. */
export type ForgeAvailability = 'ready' | 'no-cli' | 'signed-out' | 'not-github' | 'no-remote'

export type ForgeCheckState = 'pending' | 'success' | 'failure' | 'skipped'

export interface ForgeCheck {
  name: string
  state: ForgeCheckState
  url: string | null
}

export type PullRequestReviewDecision = 'approved' | 'changes-requested' | 'review-required' | null

export interface PullRequestInfo {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  baseBranch: string
  headBranch: string
  headCommit?: string
  reviewDecision: PullRequestReviewDecision
  /** The latest run of each check; re-runs replace earlier results. */
  checks: ForgeCheck[]
}

export interface PullRequestWatchStatus {
  sessionId: string | null
  /** Threads in this checkout that can receive feedback. */
  threads: { id: string; title: string }[]
}

export interface ForgeStatus {
  availability: ForgeAvailability
  /** The pull request for the checked-out branch, if one exists. */
  pullRequest: PullRequestInfo | null
}

export interface PullRequestDraft {
  title: string
  body: string
  base: string
  /** Set when the checkout is on the base branch: the name suggested for the new branch that will carry its commits. */
  branch: string | null
  /** The issue this checkout's chats were started from, which the body closes. */
  issue: IssueLink | null
}

export interface PublishRepositoryInput {
  /** `name` for the signed-in account, or `owner/name`. */
  name: string
  visibility: 'private' | 'public'
}

export interface PullRequestInput {
  title: string
  body: string
  base: string
  draft: boolean
  /** Required on the base branch: the branch created at HEAD to hold the commits. */
  branch?: string
}

/** What to hand back to an agent from a pull request. */
export type PullRequestFeedbackKind = 'checks' | 'reviews'

export interface IssueSummary {
  number: number
  title: string
  url: string
  labels: string[]
  updatedAt: number
}

/** The issue a chat was started from. */
export interface IssueLink {
  repoId: string
  number: number
  title: string
  url: string
}

/** One sign-in the GitHub CLI already holds on the execution host. Never carries the token itself. */
export interface ForgeCliAccount {
  host: string
  login: string
  /** The account `gh` uses for this host when several are signed in. */
  active: boolean
  /** `ok` when the stored token works; `invalid` when `gh` reports it expired or revoked. */
  state: 'ok' | 'invalid'
  protocol: string | null
  scopes: string[]
}

/** GitHub on one host, from its detected CLI sign-ins. Saved credentials and other providers are not here yet. */
export interface ForgeConnectionSummary {
  /** `no-cli`: `gh` is not installed. `signed-out`: installed with no account. */
  cli: 'no-cli' | 'signed-out' | 'signed-in'
  accounts: ForgeCliAccount[]
  checkedAt: number
}
