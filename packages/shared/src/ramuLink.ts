// Ramu Link: a free address for a signed-in host, from a small relay (apps/link) that hands out Cloudflare Tunnels. The
// relay only allocates tunnels; pairing, device tokens and host-identity checks stay on the host. Hosts, the relay and
// the apps agree on these limits and shapes, so change them together and only in ways shipped apps still read.

export const LINK_URL = 'https://ramu-link.akalstack.com'
/** The zone Ramu's relay names hosts in. */
export const LINK_ZONE = 'akalstack.com'

export const LINK_LIMITS = {
  /** Hosts one account keeps a link for. */
  hostsPerAccount: 1,
  /** Devices connected through one link at the same time; LAN, VPN and SSH connections do not count. */
  devices: 5,
  /** Traffic through one link in a calendar month (UTC). */
  monthlyBytes: 10 * 1024 ** 3,
  /** The share of the monthly traffic at which the host warns. */
  warnAt: 0.8,
  /** A tunnel whose host is down this long is deleted; the address stays reserved. */
  offlineReleaseMs: 10 * 60_000,
  /** Days without a device reaching the host through its link before the warning, and before the address is released. */
  idleWarnDays: 21,
  idleReleaseDays: 28,
  /** How often a host waiting for a slot asks again. */
  waitlistCheckMs: 60 * 60_000,
} as const

/** Why a host has no running link, or that it has one. */
export type LinkState =
  | 'active' // a slot and a tunnel: the address answers
  | 'waitlisted' // every slot is taken; the host asks again and takes the next free one
  | 'suspended' // over the monthly traffic, until `until`
  | 'taken' // this account's slot belongs to another of its hosts
  | 'signed-out' // the link needs a Ramu account on this host
  | 'unavailable' // the relay could not be reached or refused for another reason

/** What the relay answers to a host asking for its link. */
export type LinkReply =
  | {
      state: 'active'
      /** The host's address, such as ramu-3f9c2a1b0d.akalstack.com. */
      hostname: string
      /** The tunnel token cloudflared runs with; kept in the host's credential store. */
      token: string
      /** The day the address is released without use, as epoch milliseconds. */
      releasesAt: number
      usage: LinkUsage
    }
  | { state: 'waitlisted'; position: number; capacity: number }
  | { state: 'suspended'; until: number; usage: LinkUsage }
  | { state: 'taken'; hostName: string }
  | { state: 'unavailable'; reason: string }

export interface LinkUsage {
  /** Bytes through the link this month, as the relay last counted them. */
  bytes: number
  /** When the count was taken. */
  countedAt: number
}

/** The relay's public pool, so apps can say whether a slot is free before anyone asks for one. */
export interface LinkPool {
  capacity: number
  used: number
  waiting: number
}

/** A host asking for its link: which host, and the loopback port its tunnel reaches. */
export interface LinkRequest {
  hostId: string
  name: string
  port: number
  https: boolean
}

/** A host's link, as Settings and the phone show it. */
export interface LinkStatus {
  state: LinkState
  /** The relay this host uses: Ramu's, or one the person runs. */
  relay: string
  hostname: string | null
  position: number | null
  until: number | null
  releasesAt: number | null
  usage: LinkUsage | null
  /** Devices connected through the link right now. */
  devices: number
  /** The other host holding this account's slot, when `taken`. */
  takenBy: string | null
  reason: string | null
}

/** A host name the relay gives out: one label, so a first-level wildcard certificate covers it. */
export function linkHostname(slug: string, zone = LINK_ZONE): string {
  return `ramu-${slug}.${zone}`
}

/** Whether an address is one Ramu's relay gave out, so apps can name the route. */
export function isLinkAddress(hostname: string): boolean {
  return /^ramu-[0-9a-f]{6,32}\.akalstack\.com$/i.test(hostname)
}

/** Whether a month's traffic is near or over the link's limit. */
export function linkUsageLevel(bytes: number): 'ok' | 'warn' | 'over' {
  if (bytes >= LINK_LIMITS.monthlyBytes) return 'over'
  return bytes >= LINK_LIMITS.monthlyBytes * LINK_LIMITS.warnAt ? 'warn' : 'ok'
}

/** Ways to reach a host from anywhere, Ramu Link first when it can be had. */
export type RouteKind = 'link' | 'tailscale' | 'own-relay' | 'quick' | 'ngrok' | 'install-tailscale'

export interface RouteOption {
  kind: RouteKind
  /** Why this one, in a few words the app translates. */
  reason: 'free-stable' | 'private' | 'your-cloudflare' | 'temporary' | 'installed' | 'free-to-install'
  /** The first option is what the app offers as its main action. */
  recommended: boolean
}

export interface RouteInput {
  link: Pick<LinkStatus, 'state'> | null
  /** The relay's pool, when known: a full pool turns a host that has no link yet to the other routes first. */
  pool: LinkPool | null
  signedIn: boolean
  tools: Record<'cloudflared' | 'tailscale' | 'ngrok', boolean>
}

/**
 * Orders the ways to reach this host from anywhere for what it has. Ramu Link leads while a slot is free (or this host
 * holds one). When it cannot be had, Tailscale leads if installed: private, stable and free. Next comes running a relay
 * on the person's own Cloudflare account (the same code, without a slot), then the temporary quick tunnel when
 * cloudflared is present and ngrok when installed. With none installed, installing Tailscale is the suggestion.
 */
export function recommendRoutes(input: RouteInput): RouteOption[] {
  const state = input.link?.state
  const holds = state === 'active'
  const full = state === 'waitlisted' || (!holds && !!input.pool && input.pool.used >= input.pool.capacity)
  const blocked = full || state === 'suspended' || state === 'taken' || state === 'unavailable'
  const options: Omit<RouteOption, 'recommended'>[] = []
  const linkFirst = holds || !blocked
  if (linkFirst) options.push({ kind: 'link', reason: 'free-stable' })
  if (input.tools.tailscale) options.push({ kind: 'tailscale', reason: 'private' })
  options.push({ kind: 'own-relay', reason: 'your-cloudflare' })
  if (input.tools.cloudflared) options.push({ kind: 'quick', reason: 'temporary' })
  if (input.tools.ngrok) options.push({ kind: 'ngrok', reason: 'installed' })
  if (!input.tools.tailscale) {
    const install = { kind: 'install-tailscale' as const, reason: 'free-to-install' as const }
    // With nothing installed, installing Tailscale beats setting up a Cloudflare account.
    if (!linkFirst && !input.tools.cloudflared && !input.tools.ngrok) options.unshift(install)
    else options.push(install)
  }
  // The link stays listed after the others while it cannot be had, so joining the waitlist is still one tap.
  if (!linkFirst) options.push({ kind: 'link', reason: 'free-stable' })
  return options.map((option, index) => ({ ...option, recommended: index === 0 }))
}
