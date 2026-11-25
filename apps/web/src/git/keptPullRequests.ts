import type { RamuMethods } from '@ramu/shared/api'
import { keptReadKey, keptReads } from '@ramu/shared/keptReads'
import { queryClient } from '../dataQueries'
import { storeForHost } from '../hostStorage'

/**
 * The pull request reads a page opens on: lists, a branch's pull request, one pull request's description, threads,
 * comments and timeline.
 */
const KEPT = [
  'forge.allPullRequests',
  'forge.pullRequest',
  'forge.pullRequests',
  'forge.drafts',
  'forge.pullRequestDescription',
  'forge.reviewThreads',
  'forge.pullRequestConversation',
  'forge.pullRequestTimeline',
] as const
type KeptMethod = (typeof KEPT)[number]
const kept = new Set<string>(KEPT)

const stores = new Map<string, ReturnType<typeof keptReads>>()
const keptOn = (host: string) => {
  let store = stores.get(host)
  if (!store) stores.set(host, (store = keptReads(storeForHost(host), 'kept-pull-requests')))
  return store
}

// Each read the host answers is kept, per host, so the page opens on it next time, after a restart too.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success') return
  const [kind, host, method, ...args] = event.query.queryKey as unknown[]
  if (kind !== 'ipc' || typeof host !== 'string' || typeof method !== 'string' || !kept.has(method)) return
  keptOn(host).write(keptReadKey(method, ...args), event.query.state.data)
})

/**
 * Query options that open a pull request read on what this device last saw for it, marked stale so the host is read
 * again at once. `keyArgs` are the arguments in the read's query key.
 */
export function keptPullRequestRead<M extends KeptMethod>(host: string, method: M, ...keyArgs: unknown[]) {
  return {
    initialData: () => keptOn(host).read<Awaited<ReturnType<RamuMethods[M]>>>(keptReadKey(method, ...keyArgs)),
    initialDataUpdatedAt: 0,
  }
}
