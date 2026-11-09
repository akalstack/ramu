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
