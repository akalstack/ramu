import { useContext, useMemo, type ReactNode } from 'react'
import type { ComputerStatus } from '@ramu/shared/types'
import { invokerFor, ramu } from '../ipc'
import { LOCAL_HOST, ownHostId } from '../hosts'
import { useComputers } from './computers'
import { stableContext } from '../lib/stableContext'
import { t } from '../i18n'

export interface HostApi {
  id: string
  /** The machine running this app, as opposed to a paired host. Native actions (folder picker, editor) only make sense here. */
  isLocal: boolean
  /** Connection state, or null until the host list has loaded. */
  status: ComputerStatus | null
  /** `invoke` bound to this host. */
  invoke: typeof ramu.invoke
}

const Context = stableContext<string | null>('Host', null)

/** Names the host everything below belongs to. Without one, components use the window's own host. */
export function HostProvider({ hostId, children }: { hostId?: string; children: ReactNode }) {
  return <Context.Provider value={hostId ?? ownHostId()}>{children}</Context.Provider>
}

/** The host of the nearest `HostProvider`: each host's workspace store provides its own (see workspace.tsx). */
export function useHost(): HostApi {
  const id = useContext(Context) ?? ownHostId()
  const computers = useComputers()
  const status = computers?.computers.find((computer) => computer.id === id)?.status ?? null
  return useMemo(() => ({ id, isLocal: id === LOCAL_HOST, status, invoke: invokerFor(id) }), [id, status])
}

/**
 * Whether the host this part of the window shows is temporarily unreachable: a thread's own host, not whichever one
 * the window has selected. A rejected pairing never comes back, so it doesn't count.
 */
export function useHostConnection(): { offline: boolean; name: string } {
  const { id } = useHost()
  const host = useComputers()?.computers.find((computer) => computer.id === id)
  return {
    offline: !!host && host.status !== 'connected' && host.status !== 'rejected',
    name: host?.name ?? t('this host'),
  }
}
