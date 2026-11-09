import { pullRequestRows, type HostPullRequestRow } from '@ramu/shared/pullRequests'
import type { RepositoryPullRequests } from '@ramu/shared/types'

/**
 * The hosts a pull request can be opened on, as the desktop's host picker offers them: each host whose own checkout
 * of the repository lists it, the one it is open on always, others only while connected. One row per host.
 */
export function pullRequestHostChoices(
  lists: { host: string; repositories: RepositoryPullRequests[] }[],
  url: string,
  current: string,
  connected: (host: string) => boolean,
): HostPullRequestRow[] {
  const seen = new Set<string>()
  return lists.flatMap(({ host, repositories }) => {
    if (seen.has(host) || (host !== current && !connected(host))) return []
    const row = pullRequestRows(repositories).find((entry) => entry.pr.url === url && !entry.outside)
    if (!row) return []
    seen.add(host)
    return [{ ...row, host }]
  })
}
