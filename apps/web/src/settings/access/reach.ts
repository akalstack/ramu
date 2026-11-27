import type { TunnelChoice } from '@ramu/shared/types'

/** Who can reach this host: only this computer, devices on its network or VPN, or devices anywhere. */
export type Reach = 'computer' | 'network' | 'anywhere'
export const REACHES: readonly Reach[] = ['computer', 'network', 'anywhere']

/** How the host is reached from anywhere: no tunnel, one Ramu runs, or the address of one the person runs. */
export type TunnelMode = 'off' | TunnelChoice['kind'] | 'manual'

export const ALL_NETWORKS = '0.0.0.0'

/** The listener as Settings edits it; the port stays text while it is typed. */
export interface ListenDraft {
  enabled: boolean
  host: string
  port: string
  discoverable?: boolean
}

export interface TunnelDraft {
  mode: TunnelMode
  domain: string
  relay: string
  url: string
}

export const isLoopback = (host: string) => /^(127\.|::1$|localhost$)/.test(host)

/**
 * The three-way choice the saved listener and tunnel amount to. A tunnel Ramu runs counts as Anywhere even while the
 * listener is off, because starting one turns the listener on for this computer.
 */
export function reachOf(listen: ListenDraft, tunnel: TunnelDraft): Reach {
  if (tunnel.mode !== 'off' && tunnel.mode !== 'manual') return 'anywhere'
  if (!listen.enabled) return 'computer'
  if (tunnel.mode === 'manual') return 'anywhere'
  return isLoopback(listen.host) ? 'computer' : 'network'
}

/**
 * The listener and tunnel a choice stands for. This network opens the listener on every network unless the person
 * already picked one; Anywhere adds Ramu Link (or keeps the tunnel already chosen), and an older host that runs no
 * tunnels gets the field for one the person runs.
 */
export function chooseReach(
  reach: Reach,
  listen: ListenDraft,
  tunnel: TunnelDraft,
  runsTunnels: boolean,
): { listen: ListenDraft; tunnel: TunnelDraft } {
  if (reach === 'computer') return { listen: { ...listen, enabled: false }, tunnel: { ...tunnel, mode: 'off' } }
  const open = { ...listen, enabled: true, host: isLoopback(listen.host) ? ALL_NETWORKS : listen.host }
  if (reach === 'network') return { listen: open, tunnel: { ...tunnel, mode: 'off' } }
  if (tunnel.mode !== 'off') return { listen: open, tunnel }
  return { listen: open, tunnel: { ...tunnel, mode: runsTunnels ? 'link' : 'manual' } }
}

/** A row of the reachability card: what one part of the connection is doing right now. */
export const STATUS_LINE = 'm-0 flex flex-wrap items-center gap-x-1.5 px-3 py-2.5 text-caption text-muted-foreground'
