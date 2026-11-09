// The forge boundary the rest of the server imports. Each hosting service has an adapter (`forge/github.ts` with its
// direct API client in `forge/githubApi.ts`, `forge/gitlab.ts`, `forge/bitbucket.ts`, `forge/azure.ts`);
// `forge/route.ts` picks one from a checkout's remote.
// The operations below dispatch through it; GitHub's account and connection helpers are exported as they are.
import { listInvolvedPullRequests as githubInvolved, listPullRequests as githubPullRequests } from './forge/githubPulls'
import type {
  ForgeCheck,
  ForgeRepositorySummary,
  ForgeStatus,
  IssueLink,
  PublishRepositoryInput,
  PullRequestAction,
  ReviewCommentDraft,
  ReviewVerdict,
  PullRequestFeedbackKind,
  PullRequestInput,
  PullRequestReaction,
  PullRequestThreadStatus,
  PullRequestUpdate,
} from '@ramu/shared/types'
import { forgeAdapter } from './forge/adapter'
import { adapterFor, adapterForOrigin } from './forge/route'
import { reviewThreadsPrompt } from './forge/reviewPrompt'

export * from './forge/github'
export { forgeAdapter }

export const repositoryAccount = async (cwd: string) => (await adapterFor(cwd)).repositoryAccount(cwd)
export const checkAccess = async (cwd: string) => (await adapterFor(cwd)).checkAccess(cwd)
export const pullRequestStatus = async (cwd: string, url?: string): Promise<ForgeStatus> =>
  (await adapterFor(cwd)).pullRequestStatus(cwd, url)
export const pullRequestDraft = async (cwd: string, issue: IssueLink | null) =>
  (await adapterFor(cwd)).pullRequestDraft(cwd, issue)
export const createPullRequest = async (cwd: string, input: PullRequestInput) =>
  (await adapterFor(cwd)).createPullRequest(cwd, input)
/**
 * The prompt that hands a pull request's failing checks or open review threads to an agent. Review threads read the
 * same on every service, so their prompt is built here from the shared shape.
 */
export async function pullRequestFeedback(cwd: string, kind: PullRequestFeedbackKind, url?: string): Promise<string> {
  const adapter = await adapterFor(cwd)
  if (kind === 'checks') return adapter.checksFeedback(cwd, url)
  const { pullRequest: pr } = await adapter.pullRequestStatus(cwd, url)
  if (!pr) throw new Error('This branch has no pull request.')
  const threads = (await adapter.reviewThreads(cwd, pr.url)).filter((thread) => !thread.resolved)
  const prompt = reviewThreadsPrompt(pr, threads)
  if (!prompt) throw new Error(`Pull request #${pr.number} has no open review comments.`)
  return prompt
}
/** The checks on one commit, or null where the repository's service is not followed. */
export async function commitChecks(cwd: string, sha: string): Promise<ForgeCheck[] | null> {
  const adapter = await adapterFor(cwd)
  return adapter.commitChecks ? adapter.commitChecks(cwd, sha) : null
}
export async function commitChecksFeedback(cwd: string, sha: string, branch: string): Promise<string> {
  const adapter = await adapterFor(cwd)
  if (!adapter.commitChecksFeedback) throw new Error('Ramu does not follow this repository’s checks.')
  return adapter.commitChecksFeedback(cwd, sha, branch)
}
export const listPullRequests = async (cwd: string, options: { includeClosed: boolean }) =>
  (await adapterFor(cwd)).listPullRequests(cwd, options)
export const mergeOptions = async (cwd: string, url: string) => (await adapterFor(cwd)).mergeOptions(cwd, url)
export const pullRequestAction = async (cwd: string, url: string, action: PullRequestAction) =>
  (await adapterFor(cwd)).pullRequestAction(cwd, url, action)
export const pullRequestBody = async (cwd: string, url: string) => (await adapterFor(cwd)).pullRequestBody(cwd, url)
export const pullRequestTimeline = async (cwd: string, url: string) =>
  (await adapterFor(cwd)).pullRequestTimeline(cwd, url)
/** The files a pull request changes, or null where its service is not supported yet. */
export const pullRequestFiles = async (cwd: string, url: string) => {
  const adapter = await adapterFor(cwd)
  return adapter.pullRequestFiles ? adapter.pullRequestFiles(cwd, url) : null
}
/** Open pull requests involving the signed-in account across the service; GitHub only, empty elsewhere. */
export const listInvolvedPullRequests = async (cwd: string) =>
  (await adapterFor(cwd)).id === 'github' ? githubInvolved(cwd) : []
/** Pull requests of `repository` (`owner/repo`), a GitHub repository with no checkout, read as `cwd`'s account. */
export const listRepositoryPullRequests = (cwd: string, repository: string) =>
  githubPullRequests(cwd, { includeClosed: true }, repository)
export const reviewThreads = async (cwd: string, url: string) => (await adapterFor(cwd)).reviewThreads(cwd, url)
export const replyToThread = async (cwd: string, url: string, threadId: string, body: string) =>
  (await adapterFor(cwd)).replyToThread(cwd, url, threadId, body)
export const resolveThread = async (cwd: string, url: string, threadId: string) =>
  (await adapterFor(cwd)).resolveThread(cwd, url, threadId)
export const requestReviews = async (cwd: string, url: string, reviewers: string[]) =>
  (await adapterFor(cwd)).requestReviews(cwd, url, reviewers)
export const submitReview = async (
  cwd: string,
  url: string,
  review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
) => (await adapterFor(cwd)).submitReview(cwd, url, review)
export const pullRequestConversation = async (cwd: string, url: string) =>
  (await adapterFor(cwd)).conversation(cwd, url)
export const commentOnPullRequest = async (cwd: string, url: string, body: string) =>
  (await adapterFor(cwd)).comment(cwd, url, body)
export const lineComment = async (cwd: string, url: string, comment: Omit<ReviewCommentDraft, 'id'>) =>
  (await adapterFor(cwd)).lineComment(cwd, url, comment)
export const editComment = async (cwd: string, url: string, commentId: string, body: string) =>
  (await adapterFor(cwd)).editComment(cwd, url, commentId, body)
export const deleteComment = async (cwd: string, url: string, commentId: string) =>
  (await adapterFor(cwd)).deleteComment(cwd, url, commentId)
export const setThreadStatus = async (cwd: string, url: string, threadId: string, status: PullRequestThreadStatus) =>
  (await adapterFor(cwd)).setThreadStatus(cwd, url, threadId, status)
export const reactToComment = async (
  cwd: string,
  url: string,
  commentId: string,
  reaction: PullRequestReaction,
  remove: boolean,
) => (await adapterFor(cwd)).react(cwd, url, commentId, reaction, remove)
export const removeReviewers = async (cwd: string, url: string, reviewers: string[]) =>
  (await adapterFor(cwd)).removeReviewers(cwd, url, reviewers)
export const withdrawReview = async (cwd: string, url: string) => (await adapterFor(cwd)).withdrawReview(cwd, url)
export const updatePullRequest = async (cwd: string, url: string, update: PullRequestUpdate) =>
  (await adapterFor(cwd)).updatePullRequest(cwd, url, update)
export const rerunChecks = async (cwd: string, url: string) => (await adapterFor(cwd)).rerunChecks(cwd, url)
/** The service a checkout's remote is on, so callers can word things for it. */
export const serviceOf = async (cwd: string) => (await adapterFor(cwd)).id
export const listIssues = async (cwd: string, search: string) => (await adapterFor(cwd)).listIssues(cwd, search)
export const issueDetails = async (cwd: string, number: number) => (await adapterFor(cwd)).issueDetails(cwd, number)
/** Publishing a folder with no remote creates a GitHub repository; Ramu's publish dialog names GitHub accounts. */
export const publishRepository = async (cwd: string, input: PublishRepositoryInput) =>
  forgeAdapter('github').publishRepository(cwd, input)
export const searchRepositories = async (
  search: string,
  cwd?: string,
  origin?: string,
): Promise<ForgeRepositorySummary[]> => (await adapterForOrigin(origin)).searchRepositories(search, cwd, origin)
