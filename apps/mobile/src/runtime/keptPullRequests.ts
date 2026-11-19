import type { RamuMethods } from '@ramu/shared/api'
import { keptReadKey, keptReads, type KeptStore } from '@ramu/shared/keptReads'

type Answer<M extends keyof RamuMethods> = Awaited<ReturnType<RamuMethods[M]>>
type Kept = ReturnType<typeof keptReads>

/**
 * What the pull request screens last read from each host, kept on this phone so they open on it (after a restart too)
 * and then read again. Each host keeps its own copy, so one host's pull requests never show under another.
 */
export function keptPullRequests(store: KeptStore | null) {
  const hosts = new Map<string, Kept>()
  const of = (computerId: string) => {
    let kept = hosts.get(computerId)
    if (!kept) {
      kept = keptReads(store, `pull-requests:${computerId}`, { max: 60 })
      hosts.set(computerId, kept)
    }
    return kept
  }
  return {
    read<M extends keyof RamuMethods>(
      computerId: string,
      method: M,
      ...args: Parameters<RamuMethods[M]>
    ): Answer<M> | undefined {
      return of(computerId).read<Answer<M>>(keptReadKey(method, ...args))
    },
    keep<M extends keyof RamuMethods>(
      computerId: string,
      method: M,
      value: Answer<M>,
      ...args: Parameters<RamuMethods[M]>
    ): void {
      of(computerId).write(keptReadKey(method, ...args), value)
    },
  }
}
