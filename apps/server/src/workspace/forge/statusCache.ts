import type { ForgeStatus } from '@ramu/shared/types'

/**
 * How long a checkout's pull request status is reused. An open one is re-read often, since checks and reviews move; a
 * branch without one is looked up again soon, since the agent may open one; a merged or closed one rarely changes.
 */
export const STATUS_TTL = { open: 15_000, none: 30_000, settled: 10 * 60_000 } as const

const ttlOf = (status: ForgeStatus) =>
  !status.pullRequest ? STATUS_TTL.none : status.pullRequest.state === 'open' ? STATUS_TTL.open : STATUS_TTL.settled

/**
 * Pull request status by checkout, branch and link. Every surface that shows a pull request (Source Control, the
 * thread header, the watches) asks through here, so they share one read instead of each starting the service's CLI,
 * and asks made while a read is running wait for it. A failed read is never kept.
 */
export class PullRequestStatusCache {
  private readonly entries = new Map<string, { at: number; ttl: number; value: Promise<ForgeStatus> }>()
  constructor(private readonly now: () => number = Date.now) {}

  read(cwd: string, branch: string | null, url: string | undefined, load: () => Promise<ForgeStatus>, fresh = false) {
    const key = `${cwd}\0${branch ?? ''}\0${url ?? ''}`
    const entry = this.entries.get(key)
    if (!fresh && entry && this.now() - entry.at < entry.ttl) return entry.value
    const value = load()
    // In flight, the entry stays current until it settles; its age then counts from the answer.
    const pending = { at: this.now(), ttl: Number.POSITIVE_INFINITY, value }
    this.entries.set(key, pending)
    value.then(
      (status) => {
        if (this.entries.get(key) === pending) this.entries.set(key, { at: this.now(), ttl: ttlOf(status), value })
      },
      () => {
        if (this.entries.get(key) === pending) this.entries.delete(key)
      },
    )
    return value
  }

  /** Drops what is kept for a checkout (every branch and link), so the next read asks the service again. */
  forget(cwd?: string): void {
    if (cwd === undefined) return this.entries.clear()
    for (const key of this.entries.keys()) if (key.startsWith(`${cwd}\0`)) this.entries.delete(key)
  }
}
