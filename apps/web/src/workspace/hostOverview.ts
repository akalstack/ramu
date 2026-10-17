import { queryClient } from '../dataQueries'
import { useQueries } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { ramu } from '../ipc'
import { useComputers } from './computers'
import { onWorkspaceVisibility, workspaceVisible } from './workspaceLifetime'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { t } from '../i18n'

// The main process coalesces host events, so token streaming never refetches an overview.
ramu.on('computers:activity', ({ ids }) => {
  for (const id of ids)
    void queryClient.invalidateQueries({ queryKey: ['host-overview', id] }, { cancelRefetch: false })
})

// Share reads between the sidebar and inbox. Hidden workspaces do not poll remote computers.
export function useHostOverviews(ids: string[]) {
  const state = useComputers()
  const visible = useSyncExternalStore(onWorkspaceVisibility, workspaceVisible)
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['host-overview', id],
      queryFn: () => ramu.invoke('computers.overview', id),
      enabled: visible && state?.computers.some((c) => c.id === id && c.status === 'connected'),
      staleTime: 5000,
      refetchInterval: 15000,
    })),
  })
  return ids.map((id, i) => ({ id, ...queries[i]! }))
}

export function navigateHost(id: string, destination: HostDestination) {
  void ramu.invoke('computers.navigate', id, destination).catch((error) => notifyError(errorText(error), t('Hosts')))
}
