import { QueryClient, focusManager } from '@tanstack/react-query'
import type { RamuMethods } from '@ramu/shared/api'
import { ownHostId } from './hosts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      structuralSharing: false,
      networkMode: 'always',
      refetchOnReconnect: false,
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})
// A desktop window comes to the front without its page becoming visible again (it never stopped being visible), so the
// queries that refetch on focus also listen for the window itself.
focusManager.setEventListener((handleFocus) => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  const visible = () => handleFocus()
  window.addEventListener('focus', visible)
  globalThis.document?.addEventListener('visibilitychange', visible)
  return () => {
    window.removeEventListener('focus', visible)
    globalThis.document?.removeEventListener('visibilitychange', visible)
  }
})
/**
 * Every cached read is keyed by the host it came from: `['ipc', hostId, method, ...args]`, so one cache can hold many
 * hosts. A call that names no host means this window's own host, whose id is known before the host list loads.
 */
export const ipcQueryKeyOn = (host: string, method: string, ...args: unknown[]) =>
  ['ipc', host, method, ...args] as const
export const ipcQueryKey = (method: string, ...args: unknown[]) => ipcQueryKeyOn(ownHostId(), method, ...args)
// Reads always refresh when requested; cached data remains available immediately
// to loader UIs. Commands, shell writes and dialogs never enter the query cache.
const extraDataQueries = new Set<string>([
  'app.systemLanguages',
  'background.keepAwake',
  'schedules.runs',
  'schedules.runsPage',
  'schedules.preview',
  'tasks.plan',
  'tasks.agentDefaults',
  'tasks.bindings',
  'projects.actions',
  'projects.actionSettings',
  'providers.loginCommand',
  'providers.updates',
  'files.resolveLink',
  'git.diff',
  'git.commitBranchInfo',
  'git.commitFiles',
  'git.stashFiles',
  'git.stashFileDiff',
  'git.commitFileDiff',
  'git.commitDetails',
  'git.compareUpstream',
  'forge.pullRequest',
  'forge.watchStatus',
  'skills.availability',
  'forge.issues',
  'forge.issueLink',
  'agent.goal',
  'agent.scope',
  'agent.checkpoint',
  'agent.searchMessages',
  'agent.searchMessagesPage',
  'artifacts.page',
  'agent.continuationPrompt',
  'agent.context',
  'agent.providerHold',
  'agent.nextRoute',
  'attachments.text',
  'advisor.claude',
  'reviews.compareCurrent',
])
export const isDataQuery = (method: string) =>
  extraDataQueries.has(method) ||
  /\.(get|list|read|events|search|status|history|branches|stashes|remotes|inspect|all|catalog|editorconfig|image|media)$/.test(
    method,
  )
export function cachedData<M extends keyof RamuMethods>(method: M, ...args: Parameters<RamuMethods[M]>) {
  return queryClient.getQueryData<Awaited<ReturnType<RamuMethods[M]>>>(ipcQueryKey(method, ...args))
}
export function cachedDataOn<M extends keyof RamuMethods>(
  host: string,
  method: M,
  ...args: Parameters<RamuMethods[M]>
) {
  return queryClient.getQueryData<Awaited<ReturnType<RamuMethods[M]>>>(ipcQueryKeyOn(host, method, ...args))
}
/** Marks one host's cached reads in these domains stale (all of that host's reads when none are given). */
export function invalidateDataOn(host: string, ...domains: string[]) {
  return queryClient.invalidateQueries({
    queryKey: ['ipc', host],
    predicate: (query) =>
      !domains.length || domains.some((domain) => String(query.queryKey[2]).startsWith(`${domain}.`)),
    refetchType: 'none',
  })
}
/**
 * A host is back after a gap in which its events were lost: everything read from it is stale, and what is on screen is
 * read again now, since no later event will say what changed meanwhile.
 */
export function recoverDataOn(host: string) {
  return queryClient.invalidateQueries({ queryKey: ['ipc', host], refetchType: 'active' })
}
/** After a gap the host replayed: nothing is stale, but a read that failed during the gap is tried again. */
export function retryFailedOn(host: string) {
  return queryClient.refetchQueries({
    queryKey: ['ipc', host],
    type: 'active',
    predicate: (query) => query.state.status === 'error',
  })
}
/** Same, for this window's own host. */
export const invalidateData = (...domains: string[]) => invalidateDataOn(ownHostId(), ...domains)
