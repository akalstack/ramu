import type { ForgeAvailability, ForgeService, RepositoryPullRequests } from './types'

/** Why a repository's pull requests could not be listed: its service's sign-in, or a read that failed. */
export type AccessProblem = ForgeAvailability | 'error'

export type AccessRepo = RepositoryPullRequests & { host: string }

export interface AccessGroup<R extends AccessRepo = AccessRepo> {
  key: string
  host: string
  service: ForgeService
  problem: AccessProblem
  repos: R[]
}

/** Whether a repository needs attention before its pull requests can be listed. */
export const needsAccess = (repo: Pick<RepositoryPullRequests, 'availability' | 'error'>) =>
  !!repo.error ||
  repo.availability === 'no-cli' ||
  repo.availability === 'signed-out' ||
  repo.availability === 'choose-account'

/** One notice per host, service and problem: a sign-in is per host and service, not per repository. */
export function accessGroups<R extends AccessRepo>(repos: R[]): AccessGroup<R>[] {
  const groups = new Map<string, AccessGroup<R>>()
  for (const repo of repos) {
    const service = repo.service ?? 'github'
    const problem: AccessProblem = repo.error ? 'error' : repo.availability
    const key = [repo.host, service, problem].join('\n')
    const group = groups.get(key) ?? { key, host: repo.host, service, problem, repos: [] }
    group.repos.push(repo)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** A notice's title as an English copy key and its values, translated where it is drawn. */
export function accessGroupTitle(
  group: Pick<AccessGroup, 'problem' | 'service' | 'repos'>,
  label: (repo: AccessRepo) => string,
  serviceName: (service: ForgeService) => string,
): [string, Record<string, string | number>?] {
  if (group.problem === 'error')
    return group.repos.length === 1
      ? ['{0} could not be read', { '0': label(group.repos[0]!) }]
      : ['{0} repositories could not be read', { '0': group.repos.length }]
  if (group.problem === 'no-cli') return ['GitHub CLI is not installed']
  if (group.problem === 'choose-account') return ['Choose a GitHub account']
  return ['{0} is not connected', { '0': serviceName(group.service) }]
}

/** How to fix a service's sign-in on the host, as an English copy key. */
export function forgeUnavailableKey(availability: ForgeAvailability, service: ForgeService = 'github'): string {
  if (service === 'azure') return 'Connect Azure DevOps in Settings → Git, or set AZURE_DEVOPS_EXT_PAT on the host.'
  if (service === 'bitbucket')
    return 'Connect Bitbucket in Settings → Git, or set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN on the host.'
  if (service === 'gitlab')
    return 'Sign in to GitLab with glab auth login, or set GITLAB_TOKEN on the host, to open merge requests here.'
  if (availability === 'no-cli')
    return 'Install the GitHub CLI (gh), or save a GitHub token in Settings, to open pull requests and follow their checks here.'
  if (availability === 'choose-account')
    return 'Several GitHub accounts are saved for this server. Choose which one this repository uses.'
  return 'Sign in to GitHub with gh auth login, or save a GitHub token in Settings, to open pull requests here.'
}

/** What kind of trouble a failed read was, so the notice can say what to do instead of showing the raw message. */
export type ReadFailure = 'outage' | 'rate-limit' | 'signed-out' | 'no-access' | 'network' | 'unknown'

/**
 * Classifies the message a host's hosting-service client gave for a failed read: `gh` stderr ("gh api failed: gh: HTTP
 * 502"), the saved-token GitHub client ("HTTP 404: not found with this account…"), and the GitLab, Bitbucket and Azure
 * DevOps clients ("Bitbucket answered 503. Try again in a moment.").
 */
export function readFailure(error: string): ReadFailure {
  if (
    /HTTP 401|gh auth login|not logged in|authentication required|token was rejected|did not accept|sign-in for .+ expired/i.test(
      error,
    )
  )
    return 'signed-out'
  // GitHub's own 403 text names "rate limit or a missing permission", so only an explicit limit counts here.
  if (/rate limit exceeded|secondary rate limit|HTTP 429|answered 429/i.test(error)) return 'rate-limit'
  if (/HTTP 5\d\d|answered 5\d\d|bad gateway|service unavailable|gateway time-?out|internal server error/i.test(error))
    return 'outage'
  if (
    /could not reach|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|error connecting to|timed? ?out/i.test(error)
  )
    return 'network'
  if (
    /HTTP 40[34]|could not find|cannot see|not have permission|could not resolve to a repository|not found/i.test(error)
  )
    return 'no-access'
  return 'unknown'
}

/** The failure most of a group's repositories share, or `unknown` when they disagree. */
export function groupReadFailure(errors: string[]): ReadFailure {
  const kinds = new Set(errors.map(readFailure))
  return kinds.size === 1 ? [...kinds][0]! : 'unknown'
}

/** What a failed read means and what to do about it, as an English copy key taking the service name as `{0}`. */
export function readFailureKey(failure: ReadFailure): string {
  if (failure === 'outage') return '{0} is having trouble right now. Try again in a few minutes.'
  if (failure === 'rate-limit') return '{0} is limiting requests from this account. Try again in a few minutes.'
  if (failure === 'signed-out') return '{0} did not accept the account on this host. Reconnect it in Hosting accounts.'
  if (failure === 'no-access')
    return 'The {0} account on this host cannot see this repository. It may be private, moved or need approval.'
  if (failure === 'network') return 'The host could not reach {0}. Check its network connection, then try again.'
  return '{0} did not answer as expected. Try again, or open the details below.'
}
