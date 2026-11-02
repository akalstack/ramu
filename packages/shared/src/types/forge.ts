// Pull requests and issues on the repository's hosting service (GitHub through the `gh` CLI).

/** Why forge features are unavailable for a checkout, or `ready` when they work. */
export type ForgeAvailability = 'ready' | 'no-cli' | 'signed-out' | 'not-github' | 'no-remote' | 'choose-account'

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
  /** The hosting service, so a sign-in hint names the right one. Absent means GitHub. */
  service?: 'github' | 'gitlab'
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

/**
 * Where a connection stands after its last check. A successful identity check does not prove repository or push access;
 * `forge.checkAccess` reports that per repository.
 */
export type ForgeConnectionState =
  'connected' | 'unverified' | 'expired' | 'missing-permission' | 'rate-limited' | 'offline' | 'unsupported-server'

/** A credential Ramu saved on the execution host for one GitHub server. Never carries the token or its reference. */
export interface ForgeSavedConnection {
  id: string
  /** `github.com` or the configured Enterprise `host[:port]`. The token is only ever sent here. */
  origin: string
  login: string | null
  enabled: boolean
  /** The account used for this origin unless a repository overrides it. */
  selected: boolean
  state: ForgeConnectionState
  verifiedAt: number | null
  scopes: string[]
  /** Redacted explanation for a state other than `connected`. */
  detail: string | null
}

/** Where a repository's account comes from. */
export type ForgeAccountSource = 'saved' | 'cli' | 'none'

export interface ForgeSaveConnectionInput {
  origin: string
  /** Write-only. Never returned, logged or stored outside the host credential store. */
  token: string
  /** Replace this connection's credential; the old one stays until the new one verifies. */
  replaceId?: string
}

export interface ForgeCheckResult {
  state: 'ok' | 'denied' | 'failed' | 'unknown'
  detail: string | null
}

/** Per-repository diagnostics: API reads, writes and Git transport are reported separately and nothing is pushed. */
export interface ForgeAccessReport {
  origin: string | null
  /** The account that would be used, and why. `ambiguous` asks the person to choose in Settings. */
  account: { source: ForgeAccountSource; login: string | null; connectionId: string | null; ambiguous: boolean }
  api: { read: ForgeCheckResult; write: ForgeCheckResult }
  transport: ForgeCheckResult
  checkedAt: number
}

/** GitHub on one host, from its detected CLI sign-ins and the credentials saved on that host. */
export interface ForgeConnectionSummary {
  /** `no-cli`: `gh` is not installed. `signed-out`: installed with no account. */
  cli: 'no-cli' | 'signed-out' | 'signed-in'
  accounts: ForgeCliAccount[]
  checkedAt: number
  /** Saved credentials; empty on a host with no credential store. */
  saved: ForgeSavedConnection[]
  /** `unavailable` means a locked or missing OS credential store: saving is blocked, existing CLI use is unaffected. */
  credentialStore?: 'not-checked' | 'available' | 'unavailable'
  /** Only the machine running the host may add, replace or remove credentials. */
  canAdminister?: boolean
  /** The choice per origin: a saved connection id, or `cli` to keep using the detected sign-in. */
  selection?: Record<string, string>
}

/** A GitHub repository the signed-in account can see, for choosing something to clone. */
export interface ForgeRepositorySummary {
  /** `owner/name`. */
  fullName: string
  description: string | null
  private: boolean
  /** HTTPS clone address. Never carries credentials. */
  cloneUrl: string
  updatedAt: number
}

/** The account a repository's pull requests, issues and publishing use on its host, and why. */
export interface ForgeRepositoryAccount {
  origin: string | null
  login: string | null
  source: ForgeAccountSource
  ambiguous: boolean
}
