import type { ComputerStatus } from './types'

/**
 * A saved host's status when the app starts: a revoked pairing and a connection the person turned off keep theirs, and
 * every other host reconnects.
 */
export const restoredStatus = (status: ComputerStatus): ComputerStatus =>
  status === 'revoked' || status === 'paused' ? status : 'connecting'

/** Whether the app may connect to, or retry, a host on its own. */
export const mayConnect = (status: ComputerStatus) => status !== 'revoked' && status !== 'paused'

/**
 * The status to show as an attempt starts. A background retry of a host already shown offline keeps "Offline", so the
 * status does not flicker between Connecting and Offline on every retry; only a first or manual attempt says Connecting.
 */
export const attemptStatus = (current: ComputerStatus, retry: boolean): ComputerStatus | null =>
  retry && current === 'offline' ? null : 'connecting'

/** The status after a failed attempt: a link that was just live is reconnecting, not yet offline. */
export const failureStatus = (wasLive: boolean): ComputerStatus => (wasLive ? 'connecting' : 'offline')

/**
 * Whether a host with no usable connection is about to have one. A host shown online keeps that status while the app
 * re-opens its connection after a suspension, so a call made then waits for the connection instead of failing.
 */
export const connectionPending = (status: ComputerStatus | undefined) => status === 'online' || status === 'connecting'

/** How long a call waits for a connection that is being re-established before it reports the host offline. */
const CONNECTION_WAIT_MS = 5000

/** Holds calls made while a host's connection is being re-established until it opens, the attempt fails or time runs out. */
export function connectionGate(timeoutMs = CONNECTION_WAIT_MS) {
  const waiters = new Map<string, Set<() => void>>()
  return {
    /** Re-checks the calls waiting on a host, after its connection or its status changed. */
    settle(id: string) {
      for (const check of [...(waiters.get(id) ?? [])]) check()
    },
    /**
     * Resolves with what `read` returns once it returns a connection, or with undefined as soon as `pending` says no
     * attempt is under way or the wait runs out.
     */
    wait<T>(id: string, read: () => T | undefined, pending: () => boolean): Promise<T | undefined> {
      const now = read()
      if (now !== undefined || !pending()) return Promise.resolve(now)
      return new Promise((resolve) => {
        const set = waiters.get(id) ?? new Set<() => void>()
        waiters.set(id, set)
        const finish = (value: T | undefined) => {
          clearTimeout(timer)
          set.delete(check)
          if (!set.size && waiters.get(id) === set) waiters.delete(id)
          resolve(value)
        }
        const check = () => {
          const value = read()
          if (value !== undefined || !pending()) finish(value)
        }
        const timer = setTimeout(() => finish(read()), timeoutMs)
        set.add(check)
      })
    },
  }
}
