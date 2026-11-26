/** Networks that Docker, VMs and macOS create. Another device almost never reaches a host through them. */
export const VIRTUAL_INTERFACE = /^(bridge|docker|br-|veth|vmnet|vboxnet|virbr|awdl|llw|anpi|ap|gif|stf)\d*/i
const VPN_INTERFACE = /^(utun|tun|tap|wg|wt|tailscale|zt|nordlynx|netbird)/i
const MESH_ADDRESS = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|^fd7a:115c:a1e0:/i
const PRIVATE_ADDRESS = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^f[cd]/i

export const hostOfUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return url
  }
}

// Ramu Link's addresses (`linkHostname` in ramuLink.ts). Written out rather than imported: the phone's tests load this
// file as it is, with no bundler to resolve imports.
const RAMU_LINK = /^ramu-[a-z0-9]+\.akalstack\.com$/i

/**
 * The tunnel an address belongs to, from its name: Ramu Link's own addresses, Cloudflare's quick tunnels, Tailscale
 * names (Funnel or the tailnet) and ngrok's domains. Null for anything else.
 */
function tunnelName(address: string): 'Ramu Link' | 'Quick tunnel (Cloudflare)' | 'Tailscale' | 'ngrok' | null {
  const host = address.toLowerCase()
  if (RAMU_LINK.test(host)) return 'Ramu Link'
  if (host.endsWith('.trycloudflare.com')) return 'Quick tunnel (Cloudflare)'
  if (host.endsWith('.ts.net')) return 'Tailscale'
  if (/\.ngrok(-free)?\.(app|dev|io)$/.test(host)) return 'ngrok'
  return null
}

/**
 * A plain name for an address, so people choose "Ramu Link", "VPN" or "Local network" rather than an interface or IP.
 * `tunnel` is the interface a host gives its public address. Pass through `t()`.
 */
export function networkName(
  address: string,
  interfaceName = '',
):
  | NonNullable<ReturnType<typeof tunnelName>>
  | 'Tunnel'
  | 'VPN'
  | 'Local network'
  | 'Virtual network'
  | 'Other network' {
  const tunnel = tunnelName(address)
  if (tunnel) return tunnel
  if (interfaceName === 'tunnel') return 'Tunnel'
  if (VIRTUAL_INTERFACE.test(interfaceName)) return 'Virtual network'
  if (VPN_INTERFACE.test(interfaceName) || MESH_ADDRESS.test(address)) return 'VPN'
  return PRIVATE_ADDRESS.test(address) ? 'Local network' : 'Other network'
}

/** How a device reaches a host, for a short "via …" label. Pass the label through `t()`. */
export function routeName(url: string | null, ssh?: string): 'LAN' | 'VPN' | 'SSH' | 'Internet' | null {
  if (ssh) return 'SSH'
  if (!url) return null
  const host = hostOfUrl(url).toLowerCase()
  if (MESH_ADDRESS.test(host) || host.endsWith('.ts.net')) return 'VPN'
  if (PRIVATE_ADDRESS.test(host) || host.endsWith('.local') || /^fe80:/i.test(host)) return 'LAN'
  return 'Internet'
}

/**
 * How directly an address reaches its host, fastest first: the local network, then a VPN, then anything over the
 * internet (Ramu Link, a tunnel, a public address). A device prefers the lowest that answers.
 */
export function routeSpeed(url: string): 0 | 1 | 2 {
  const route = routeName(url)
  return route === 'LAN' ? 0 : route === 'VPN' ? 1 : 2
}

/** The routes faster than `current`, fastest first; the order among equals is kept. */
export function fasterRoutes(current: string, routes: string[]): string[] {
  const speed = routeSpeed(current)
  return routes
    .filter((route) => route !== current && routeSpeed(route) < speed)
    .map((route, index) => ({ route, index }))
    .sort((a, b) => routeSpeed(a.route) - routeSpeed(b.route) || a.index - b.index)
    .map(({ route }) => route)
}

/**
 * Whether what travels over an address is encrypted on the way: https, or a VPN, which encrypts everything it carries.
 * A plain-http address on the local network is the one case where others on that network could read it.
 */
export function routeEncrypted(url: string): boolean {
  return url.startsWith('https:') || routeName(url) === 'VPN'
}

/**
 * The faster routes a device may move to on its own, fastest first. From an encrypted address it moves only to another
 * encrypted one (a VPN), unless the person allowed this host's unencrypted local network (`allowPlain`).
 */
export function upgradeRoutes(current: string, routes: string[], allowPlain = false): string[] {
  return fasterRoutes(current, routes).filter(
    (route) => allowPlain || !routeEncrypted(current) || routeEncrypted(route),
  )
}
