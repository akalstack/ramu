import type {
  PullRequestFile,
  ForgeAccessReport,
  ForgeCheck,
  ForgeRepositoryAccount,
  ForgeRepositorySummary,
  ForgeStatus,
  IssueLink,
  IssueSummary,
  MergeOptions,
  PublishRepositoryInput,
  PullRequestAction,
  PullRequestList,
  ReviewCommentDraft,
  PullRequestThread,
  ReviewVerdict,
  PullRequestDraft,
  PullRequestInput,
} from '@ramu/shared/types'

/** The hosting services with an adapter. */
export type ForgeProviderId = import('@ramu/shared/types').ForgeService

/**
 * What a hosting provider must do for a checkout (`cwd`). Everything provider-specific lives behind this: how the
 * account is found, which API or CLI is called, how a pull request and its checks are read. Callers pass a checkout
 * and get the shared shapes back, so a second provider does not change them.
 */
export interface ForgeAdapter {
  readonly id: ForgeProviderId
  /** The account this checkout's pull requests, issues and publishing use, and why. */
  repositoryAccount(cwd: string): Promise<ForgeRepositoryAccount>
  /** API reads, writes and Git transport, reported separately; nothing is pushed. */
  checkAccess(cwd: string): Promise<ForgeAccessReport>
  pullRequestStatus(cwd: string, url?: string): Promise<ForgeStatus>
  pullRequestDraft(cwd: string, issue: IssueLink | null): Promise<PullRequestDraft>
  createPullRequest(cwd: string, input: PullRequestInput): Promise<ForgeStatus>
  /** The prompt for fixing failing checks, with the end of each failed job's log where the service has one. */
  checksFeedback(cwd: string, url?: string): Promise<string>
  /** The checks on one commit, for a push to the default branch; absent where the service is not followed. */
  commitChecks?(cwd: string, sha: string): Promise<ForgeCheck[]>
  /** The prompt for a default branch that a push broke, with the end of each failed job's log. */
  commitChecksFeedback?(cwd: string, sha: string, branch: string): Promise<string>
  /** The repository's open pull requests, and the latest closed and merged ones when asked. */
  listPullRequests(cwd: string, options: { includeClosed: boolean }): Promise<PullRequestList>
  /** The merge methods the repository allows and what still blocks merging `url`. */
  mergeOptions(cwd: string, url: string): Promise<MergeOptions>
  /** Merge, close, reopen, mark ready or update the branch of `url`. */
  pullRequestAction(cwd: string, url: string, action: PullRequestAction): Promise<void>
  /** The description of `url`, for the first message of a thread opened on it. */
  pullRequestBody(cwd: string, url: string): Promise<string>
  /** The files `url` changes with their diffs, for its full view; absent where not supported yet. */
  pullRequestFiles?(cwd: string, url: string): Promise<{ files: PullRequestFile[]; more: boolean }>
  /** Every review thread of `url`, resolved ones included, in one shape across services. */
  reviewThreads(cwd: string, url: string): Promise<PullRequestThread[]>
  /** Posts a reply under a thread and returns the new comment's id. */
  replyToThread(cwd: string, url: string, threadId: string, body: string): Promise<string>
  /** Marks a thread resolved; a no-op for threads the service cannot resolve. */
  resolveThread(cwd: string, url: string, threadId: string): Promise<void>
  /** Asks these reviewers (logins as the service names them) to review again. */
  requestReviews(cwd: string, url: string, reviewers: string[]): Promise<void>
  /** Posts one review of someone else's pull request with its inline comments. */
  submitReview(
    cwd: string,
    url: string,
    review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
  ): Promise<void>
  listIssues(cwd: string, search: string): Promise<IssueSummary[]>
  issueDetails(cwd: string, number: number): Promise<{ title: string; url: string; prompt: string }>
  publishRepository(cwd: string, input: PublishRepositoryInput): Promise<void>
  /** Repositories to clone from a server this host has access to; `origin` names an Enterprise server. */
  searchRepositories(search: string, cwd?: string, origin?: string): Promise<ForgeRepositorySummary[]>
}

const adapters = new Map<ForgeProviderId, ForgeAdapter>()

/** Registers an adapter once, at module load. A second registration for the same id is a bug. */
export function registerForgeAdapter(adapter: ForgeAdapter): ForgeAdapter {
  if (adapters.has(adapter.id)) throw new Error(`A forge adapter for ${adapter.id} is already registered`)
  adapters.set(adapter.id, adapter)
  return adapter
}

/** The adapter for a provider; throws for one with no adapter so a caller never gets a silent no-op. */
export function forgeAdapter(id: ForgeProviderId): ForgeAdapter {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`No forge adapter for ${id}`)
  return adapter
}
