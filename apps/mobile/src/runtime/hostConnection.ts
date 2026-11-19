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

/** The host answered that it has no such call: it runs an older Ramu than this phone, and updating it adds the call. */
export const isOlderHostRefusal = (error: unknown) =>
  error instanceof Error && /^Unknown method [\w.]+$/.test(error.message)
