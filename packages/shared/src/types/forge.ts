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

/** A hosting service with its own adapter. */
export type ForgeService = 'github' | 'gitlab' | 'bitbucket' | 'azure'

export interface ForgeStatus {
  availability: ForgeAvailability
  /** The hosting service, so a sign-in hint names the right one. Absent means GitHub. */
  service?: ForgeService
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

/** Whether the pull request merges cleanly into its base, as the hosting service last computed it. */
export type PullRequestMergeability = 'clean' | 'conflicts' | 'behind' | 'blocked' | 'unknown'

/** The rolled-up state of a pull request's checks; null when it has none. */
export type PullRequestChecksState = 'failure' | 'pending' | 'success' | null

/** Which part of the list a pull request belongs to for the account in use. */
export type PullRequestGroup = 'mine' | 'review' | 'other'

/** One row of a repository's pull request list. */
export interface PullRequestSummary {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  baseBranch: string
  headBranch: string
  headCommit?: string
  author: string | null
  /** Opened from a fork: its branch is not on this repository's remote, so it cannot be pushed to from here. */
  fork: boolean
  reviewDecision: PullRequestReviewDecision
  checks: PullRequestChecksState
  mergeable: PullRequestMergeability
  /** Review threads nobody has resolved yet; null when the service does not say. */
  openThreads: number | null
  requestedReviewers: string[]
  group: PullRequestGroup
  updatedAt: number
  /** Lines added and removed, where the service reports them. */
  additions?: number
  deletions?: number
  /** The service's labels on it, where it reports them. */
  labels?: string[]
}

export interface PullRequestList {
  availability: ForgeAvailability
  service?: ForgeService
  /** The account the list was read with, so "yours" can be explained. */
  viewer: string | null
  pullRequests: PullRequestSummary[]
  /** Threads already working on each pull request, by URL, so a row can open them instead of starting another. */
  threads?: Record<string, { taskId: string; title: string }[]>
}

/** One repository's pull requests on the Pull requests page, with the project it belongs to. */
export interface RepositoryPullRequests extends PullRequestList {
  projectId: string
  projectName: string
  repoId: string
  repoName: string
  /** Why this repository could not be read this time; the rest of the page still shows. */
  error?: string
  /** Ramu's own state per pull request URL: replies drafted, or an agent working on its feedback. */
  local: Record<string, { draftsReady?: boolean; agentWorking?: boolean }>
  /**
   * A repository in no project, listed for the pull requests that involve the person there (theirs, or a review asked of
   * them). Ramu has no checkout of it, so its rows open on the hosting service.
   */
  outside?: boolean
}

/** One file a pull request changes, as its full view lists them. */
export interface PullRequestFile {
  path: string
  /** Where a renamed file came from. */
  previousPath?: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  /** The unified diff hunks; null for a binary file or one too large for the service to diff. */
  patch: string | null
  /** The patch was cut at Ramu's limit. */
  truncated?: boolean
}

/** One step in a pull request's history, oldest first in its timeline. */
export interface PullRequestTimelineEvent {
  kind:
    'commit' | 'review' | 'comment' | 'review-requested' | 'force-pushed' | 'ready' | 'merged' | 'closed' | 'reopened'
  /** Who did it, where the service names them. */
  actor: string | null
  at: number
  /** A commit's first line, a review's verdict, a comment's opening, or whom a review was asked of. */
  text?: string
  /** A review's verdict, for its colour. */
  verdict?: 'approved' | 'changes-requested' | 'commented' | 'dismissed'
  url?: string
}

/** What opening a pull request in a thread needs: the thread already on it, or how to start one. */
export interface PullRequestHandoff {
  existing: { taskId: string; title: string } | null
  /** The worktree's branch; null when the pull request cannot be checked out here (a fork on a service without pull refs). */
  checkout: { repoId: string; branch: string; fetchRef?: string } | null
  title: string
  prompt: string
}

/**
 * Where a pull request stands for the person, most pressing first: one word for the row, the chip and the phone.
 * `replies-ready` and `agent-working` come from Ramu's own state; the rest from the hosting service.
 */
export type PullRequestStage =
  | 'replies-ready'
  | 'agent-working'
  | 'conflicts'
  | 'checks-failing'
  | 'changes-requested'
  | 'draft'
  | 'checks-pending'
  | 'review-required'
  | 'ready'
  | 'merged'
  | 'closed'

/** What a thread row shows of the pull request for its branch. */
export interface TaskPullRequest {
  repoId: string
  number: number
  title: string
  url: string
  state: PullRequestSummary['state']
  draft: boolean
  stage: PullRequestStage
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'

/** What merging needs: the methods the repository allows and what still blocks it. */
export interface MergeOptions {
  methods: MergeMethod[]
  /** Reasons the merge cannot happen yet, as sentences; empty when it can. */
  blockers: string[]
  /** The service can delete the head branch after merging. */
  canDeleteBranch: boolean
}

export type PullRequestAction =
  | { kind: 'merge'; method: MergeMethod; deleteBranch: boolean }
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'ready' }
  | { kind: 'update-branch' }

/** One review thread, the same shape on every hosting service. */
export interface PullRequestThread {
  id: string
  path: string | null
  line: number | null
  outdated: boolean
  resolved: boolean
  /** Whether Ramu can mark it resolved on this service. */
  resolvable: boolean
  comments: PullRequestComment[]
}

export interface PullRequestComment {
  id: string
  author: string | null
  /** A bot or service account, shown as such. */
  bot: boolean
  /** Has write access, was asked to review, or opened the pull request. Others never start a round on their own. */
  trusted: boolean
  body: string
  createdAt: number
}

/** What the agent decided about one thread. `skipped` posts nothing. */
export type ReviewReplyOutcome = 'fixed' | 'no-change' | 'question' | 'skipped'

export interface ReviewReplyDraft {
  threadId: string
  outcome: ReviewReplyOutcome
  reply: string
  /** The commit that addressed it, linked in the reply after the push. */
  commit: string | null
  /** Set once posted, so a retry never posts it twice. */
  postedId?: string | null
  error?: string | null
}

/** A comment the agent drafted while reviewing someone's pull request. */
export interface ReviewCommentDraft {
  id: string
  path: string
  line: number
  body: string
}

export type ReviewVerdict = 'comment' | 'approve' | 'request-changes'

/** Replies to the open threads of the person's own pull request, waiting to be checked and sent. */
export interface ReviewReplyBatch {
  kind: 'replies'
  id: string
  url: string
  number: number
  repoId: string
  branch: string
  sessionId: string
  /** The threads as they were given to the agent, for showing the comment beside its draft. */
  threads: PullRequestThread[]
  drafts: ReviewReplyDraft[]
  /** Reviewers who requested changes; review is asked of them again on send. */
  reviewers: string[]
  createdAt: number
}

/** A review of someone else's pull request, drafted by an agent, waiting to be checked and posted. */
export interface ReviewDraftBatch {
  kind: 'review'
  id: string
  url: string
  number: number
  repoId: string
  sessionId: string
  verdict: ReviewVerdict
  body: string
  comments: ReviewCommentDraft[]
  createdAt: number
}

export type PullRequestDraftBatch = ReviewReplyBatch | ReviewDraftBatch

export interface SendRepliesInput {
  push: boolean
  resolveFixed: boolean
  requestReview: boolean
  /** Edited replies and outcomes by thread id; a thread left out keeps the agent's draft. */
  edits: { threadId: string; outcome: ReviewReplyOutcome; reply: string }[]
}

export interface SendRepliesResult {
  pushed: boolean
  posted: number
  failed: { threadId: string; error: string }[]
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

/** GitLab on one host: the servers its `glab` sign-in or `GITLAB_TOKEN` covers. Tokens never leave the host. */
export interface GitlabSummary {
  /** `no-cli`: `glab` is not installed (a saved token or `GITLAB_TOKEN` still works). */
  cli: 'no-cli' | 'installed'
  accounts: {
    origin: string
    source: 'saved' | 'cli' | 'environment'
    /** Filled by a connection check; null before one. */
    login: string | null
    state: 'unchecked' | 'ok' | 'failed'
    error?: string
  }[]
}

/** Bitbucket Cloud on one host: the credential saved in Settings or given in its environment. Never the secret. */
export interface BitbucketSummary {
  source: 'saved' | 'environment' | null
  /** The account email of an API token; null for an access token. */
  email: string | null
  login: string | null
  state: 'unchecked' | 'ok' | 'failed'
  error?: string
}

/** Azure DevOps Services on one host: the personal access token saved in Settings or given in its environment. */
export interface AzureSummary {
  source: 'saved' | 'environment' | null
  /** The organization repositories are browsed in; null when none was named. */
  organization: string | null
  login: string | null
  state: 'unchecked' | 'ok' | 'failed'
  error?: string
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
