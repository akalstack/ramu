import type {
  ForgeAccessReport,
  ForgeRepositoryAccount,
  ForgeRepositorySummary,
  ForgeStatus,
  IssueLink,
  IssueSummary,
  PublishRepositoryInput,
  PullRequestDraft,
  PullRequestFeedbackKind,
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
  /** The prompt for fixing failing checks or addressing review comments. */
  pullRequestFeedback(cwd: string, kind: PullRequestFeedbackKind, url?: string): Promise<string>
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
