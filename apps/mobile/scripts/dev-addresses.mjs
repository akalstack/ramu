// List mesh VPNs first, then LAN interfaces. Preserve explicit Expo overrides.
const mesh = (address) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
const privateLan = (address) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
const virtual = /^(bridge|vmnet|vnic|docker|veth|br-|awdl|llw|ap)/
const vpn = /^(utun|tun|tap|wg|wt|tailscale|netbird)/i

export function devAddresses(interfaces) {
  const entries = Object.entries(interfaces)
    .flatMap(([name, list]) => (list ?? []).map((entry) => ({ name, ...entry })))
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && (mesh(entry.address) || privateLan(entry.address)))
  const rank = (entry) => (mesh(entry.address) ? 0 : vpn.test(entry.name) ? 1 : virtual.test(entry.name) ? 3 : 2)
  return [...new Set(entries.sort((a, b) => rank(a) - rank(b)).map((entry) => entry.address))]
}

export function publishesLocalAddresses(env, args) {
  return !(
    args.includes('--tunnel') ||
    args.includes('--localhost') ||
    args.some((arg) => arg === '--host' || arg.startsWith('--host=')) ||
    env.REACT_NATIVE_PACKAGER_HOSTNAME ||
    env.EXPO_PACKAGER_PROXY_URL
  )
}

export function devEnvironment(env, args, addresses) {
  if (!publishesLocalAddresses(env, args) || !addresses.length) return { ...env }
  // A global hostname override rewrites manifests opened through every other interface too.
  // Keep request Host handling intact, and opt into Expo's own Bonjour publisher for nearby clients.
  return { ...env, EXPO_UNSTABLE_BONJOUR: env.EXPO_UNSTABLE_BONJOUR ?? '1' }
}
