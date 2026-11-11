import type {
  PullRequestTimelineEvent,
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
  PullRequestConversationComment,
  PullRequestReaction,
  PullRequestThreadStatus,
  PullRequestUpdate,
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
  /** The live address of the newest successful production deployment the service recorded; null when it has none. */
  productionAddress?(cwd: string): Promise<string | null>
  /** The repository's open pull requests, and the latest closed and merged ones when asked. */
  listPullRequests(cwd: string, options: { includeClosed: boolean }): Promise<PullRequestList>
  /** The merge methods the repository allows and what still blocks merging `url`. */
  mergeOptions(cwd: string, url: string): Promise<MergeOptions>
  /** Merge (now or once checks pass), close, reopen, mark ready or draft, or update the branch of `url`. */
  pullRequestAction(cwd: string, url: string, action: PullRequestAction): Promise<void>
  /** The description of `url`, for the first message of a thread opened on it. */
  pullRequestBody(cwd: string, url: string): Promise<string>
  /** The latest history of `url`, oldest first, for its full view. */
  pullRequestTimeline(cwd: string, url: string): Promise<PullRequestTimelineEvent[]>
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
  /** Posts one review of someone else's pull request with its inline comments and suggested changes. */
  submitReview(
    cwd: string,
    url: string,
    review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
  ): Promise<void>
  /** Comments on the pull request itself, on no file, that `reviewThreads` does not already return. */
  conversation(cwd: string, url: string): Promise<PullRequestConversationComment[]>
  /** Posts a comment on the pull request itself and returns its id. */
  comment(cwd: string, url: string, body: string): Promise<string>
  /** Posts one comment on a line or range outside a review and returns its id. */
  lineComment(cwd: string, url: string, comment: Omit<ReviewCommentDraft, 'id'>): Promise<string>
  /** Changes a comment the account wrote; `commentId` is one this adapter returned or listed. */
  editComment(cwd: string, url: string, commentId: string, body: string): Promise<void>
  deleteComment(cwd: string, url: string, commentId: string): Promise<void>
  /** Resolves (`resolved` and Azure DevOps's other closed statuses) or reopens (`active`) a thread. */
  setThreadStatus(cwd: string, url: string, threadId: string, status: PullRequestThreadStatus): Promise<void>
  react(cwd: string, url: string, commentId: string, reaction: PullRequestReaction, remove: boolean): Promise<void>
  removeReviewers(cwd: string, url: string, reviewers: string[]): Promise<void>
  /** Takes back the account's own approval or change request. */
  withdrawReview(cwd: string, url: string): Promise<void>
  updatePullRequest(cwd: string, url: string, update: PullRequestUpdate): Promise<void>
  /** Runs the failed checks of the head commit again; returns how many runs were started. */
  rerunChecks(cwd: string, url: string): Promise<number>
  listIssues(cwd: string, search: string): Promise<IssueSummary[]>
  issueDetails(cwd: string, number: number): Promise<{ title: string; url: string; prompt: string }>
  publishRepository(cwd: string, input: PublishRepositoryInput): Promise<void>
  /** Repositories to clone from a server this host has access to; `origin` names an Enterprise server. */
  searchRepositories(search: string, cwd?: string, origin?: string): Promise<ForgeRepositorySummary[]>
}

/** Files per page the services return at most; a pull request with more says so instead of paging on. */
export const FILES_PAGE = 100
/** A patch longer than this is cut, so one generated file cannot swamp the view or the connection. */
export const PATCH_LIMIT = 40_000

/** A file's patch cut at Ramu's limit, marked when it was cut. */
export function boundedPatch(patch: string | null): Pick<PullRequestFile, 'patch' | 'truncated'> {
  return patch && patch.length > PATCH_LIMIT ? { patch: patch.slice(0, PATCH_LIMIT), truncated: true } : { patch }
}

/** How many of the latest events a pull request's full view shows. */
export const TIMELINE_LENGTH = 50
/** A comment or commit line longer than this is cut to its opening. */
const TEXT_LIMIT = 200

/** The first line of a text, cut to the timeline's limit; undefined when there is nothing to show. */
export function opening(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text
    .trim()
    .split('\n')
    .find((entry) => entry.trim())
    ?.trim()
  if (!line) return undefined
  return line.length > TEXT_LIMIT ? `${line.slice(0, TEXT_LIMIT - 1)}…` : line
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
