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

/** A plain name for an address, so people choose "VPN" or "Local network" rather than an interface or IP. Pass through `t()`. */
export function networkName(
  address: string,
  interfaceName = '',
): 'VPN' | 'Local network' | 'Virtual network' | 'Other network' {
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
