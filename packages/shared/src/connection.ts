// Where a device stands with one host, named the same way on the desktop and the phone. Being connected is not yet
// being up to date: after a gap the device reads again what it shows, and until that ends what is on screen may be old.

/** The link itself, as each client's own connection code reports it. */
export type HostLink = 'connected' | 'connecting' | 'offline' | 'rejected' | 'paused'

export type ConnectionState =
  /** Connected, and what is shown is what the host has. */
  | 'current'
  /** Connected, and still reading what changed while it was away. */
  | 'synchronizing'
  | 'connecting'
  | 'disconnected'
  /** The host no longer accepts this device; only pairing again helps. */
  | 'rejected'
  /** The person switched this connection off. */
  | 'paused'

export function connectionState(link: HostLink, caughtUp: boolean): ConnectionState {
  if (link === 'connected') return caughtUp ? 'current' : 'synchronizing'
  return link === 'offline' ? 'disconnected' : link
}
