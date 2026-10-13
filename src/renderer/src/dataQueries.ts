import { QueryClient } from '@tanstack/react-query'
import type { RamuMethods } from '../../shared/api'

export const queryClient = new QueryClient({ defaultOptions: { queries: {
  structuralSharing: false, networkMode: 'always', refetchOnReconnect: false, staleTime: 0, gcTime: 5 * 60_000, retry: false,
  refetchOnWindowFocus: false,
} } })
export const ipcQueryKey = (method: string, ...args: unknown[]) => ['ipc', method, ...args] as const
// Reads always refresh when requested; cached data remains available immediately
// to loader UIs. Commands, shell writes and dialogs never enter the query cache.
const extraDataQueries = new Set<string>([
  'app.systemLanguages', 'background.keepAwake', 'schedules.runs', 'schedules.preview',
  'tasks.plan', 'tasks.bindings', 'projects.actions', 'providers.loginCommand', 'providers.updates',
  'files.resolveLink', 'git.diff', 'git.commitBranchInfo', 'git.commitFiles',
  'git.stashFiles', 'git.stashFileDiff', 'git.commitFileDiff', 'git.commitDetails', 'git.compareUpstream', 'agent.goal', 'agent.scope',
  'agent.searchMessages', 'agent.continuationPrompt', 'agent.context', 'agent.providerHold',
  'attachments.text', 'advisor.claude', 'reviews.compareCurrent',
])
export const isDataQuery = (method: string) => extraDataQueries.has(method) || /\.(get|list|read|events|search|status|history|branches|stashes|remotes|inspect|all|catalog|editorconfig|image|media)$/.test(method)
export function cachedData<M extends keyof RamuMethods>(method: M, ...args: Parameters<RamuMethods[M]>) {
  return queryClient.getQueryData<Awaited<ReturnType<RamuMethods[M]>>>(ipcQueryKey(method, ...args))
}
export function invalidateData(...domains: string[]) {
  return queryClient.invalidateQueries({ queryKey: ['ipc'], predicate: query => !domains.length || domains.some(domain => String(query.queryKey[1]).startsWith(`${domain}.`)), refetchType: 'none' })
}
