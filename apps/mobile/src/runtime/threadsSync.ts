import type { ComputerStatus } from './types'

/** How the read of a host's thread list over its current connection ended; absent while it has not ended. */
export type ThreadListRead = 'read' | 'failed'

/**
 * What the thread list says about its own freshness: `loading` with nothing to show yet, `refreshing` while rows this
 * phone already holds are read again, `offline` when nothing is held and no host in view could be read, else `ready`.
 */
export type ThreadsSync = 'loading' | 'refreshing' | 'ready' | 'offline'

export function threadsSync(
  hosts: readonly { status: ComputerStatus; read?: ThreadListRead }[],
  hasRows: boolean,
): ThreadsSync {
  // A revoked pairing and a host the person switched off are not being read and say so themselves.
  const reachable = hosts.filter((host) => host.status === 'online' || host.status === 'connecting')
  if (reachable.some((host) => host.status === 'connecting' || !host.read)) return hasRows ? 'refreshing' : 'loading'
  const unread = hosts.some((host) => host.status === 'offline') || reachable.some((host) => host.read === 'failed')
  return !hasRows && unread && !reachable.some((host) => host.read === 'read') ? 'offline' : 'ready'
}
