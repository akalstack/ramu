// The forge boundary the rest of the server imports. Each hosting service has an adapter (`forge/github.ts` with its
// direct API client in `forge/githubApi.ts`, `forge/gitlab.ts`, `forge/bitbucket.ts`, `forge/azure.ts`);
// `forge/route.ts` picks one from a checkout's remote.
// The operations below dispatch through it; GitHub's account and connection helpers are exported as they are.
import type {
  ForgeRepositorySummary,
  ForgeStatus,
  IssueLink,
  PublishRepositoryInput,
  PullRequestFeedbackKind,
  PullRequestInput,
} from '@ramu/shared/types'
import { forgeAdapter } from './forge/adapter'
import { adapterFor, adapterForOrigin } from './forge/route'

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
export const pullRequestFeedback = async (cwd: string, kind: PullRequestFeedbackKind, url?: string) =>
  (await adapterFor(cwd)).pullRequestFeedback(cwd, kind, url)
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
