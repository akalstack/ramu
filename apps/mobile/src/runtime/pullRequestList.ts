import type { MergedPullRequestRow } from '@ramu/shared/pullRequests'

/** The access notices hidden on this phone, kept with its other small preferences. */
export const HIDDEN_ACCESS_KEY = 'pull-requests-hidden-access'

export const pullRequestRepoLabel = (repo: { projectName: string; repoName: string }) =>
  repo.projectName === repo.repoName ? repo.repoName : `${repo.projectName} / ${repo.repoName}`

/** The hidden notices' keys from their saved draft; an unreadable one hides none. */
export function hiddenAccess(saved: string | undefined): string[] {
  try {
    const parsed = JSON.parse(saved || '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

/** Hosts whose rows are what this phone last read: kept here, but out of reach now. */
export const offlineHosts = (kept: string[], online: string[]) => kept.filter((id) => !online.includes(id))

/** The stage already says when checks are failing or running; a checks mark is added only when it is about something else. */
export const checksAside = (row: Pick<MergedPullRequestRow, 'stage' | 'pr'>) =>
  row.stage !== 'checks-failing' &&
  row.stage !== 'checks-pending' &&
  (row.pr.checks === 'failure' || row.pr.checks === 'pending')
