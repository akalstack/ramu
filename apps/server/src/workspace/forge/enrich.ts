import type { PullRequestSummary } from '@ramu/shared/types'

/** How many open pull requests get their details read per list, newest first; older rows keep what the list said. */
const LIMIT = 20
const CONCURRENCY = 4

/**
 * Fills in what a service's list call leaves out (checks, approval, open threads) with one small read per pull request.
 * A read that fails leaves that row as it was, so one inaccessible pull request never empties the list.
 */
export async function enrichOpen(
  rows: PullRequestSummary[],
  read: (pr: PullRequestSummary) => Promise<Partial<PullRequestSummary>>,
): Promise<PullRequestSummary[]> {
  const chosen = new Set(
    rows
      .filter((pr) => pr.state === 'open')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LIMIT)
      .map((pr) => pr.url),
  )
  const details = new Map<string, Partial<PullRequestSummary>>()
  const queue = rows.filter((pr) => chosen.has(pr.url))
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let pr = queue.shift(); pr; pr = queue.shift()) {
        const found = await read(pr).catch(() => null)
        if (found) details.set(pr.url, found)
      }
    }),
  )
  return rows.map((pr) => ({ ...pr, ...details.get(pr.url) }))
}
