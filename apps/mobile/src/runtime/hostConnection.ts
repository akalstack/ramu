import type { ComputerStatus } from './types'

/**
 * A saved host's status when the app starts: a revoked pairing and a connection the person turned off keep theirs, and
 * every other host reconnects.
 */
export const restoredStatus = (status: ComputerStatus): ComputerStatus =>
  status === 'revoked' || status === 'paused' ? status : 'connecting'

/** Whether the app may connect to, or retry, a host on its own. */
export const mayConnect = (status: ComputerStatus) => status !== 'revoked' && status !== 'paused'
