// Starts Metro for a phone on the same network. Expo otherwise advertises the Mac's `<name>.local` hostname,
// which an iPhone often cannot resolve ("hostname not found"), so hand it the LAN address instead.
// Usage: node scripts/start.mjs [--dev-client | --go] [expo start options]
// Defaults to the development build (EAS `development` profile or `expo run:*`); pass --go for Expo Go, which cannot load Ramu's native modules or WebRTC.
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const args = process.argv.slice(2)
if (!args.includes('--go') && !args.includes('--dev-client')) args.unshift('--dev-client')

// Private LAN ranges only: VPN (100.x, NetBird/Tailscale) and container bridges are not reachable from the phone.
const isLan = (ip) => /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
const lan = () => {
  const found = Object.entries(networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((entry) => ({ name, ...entry })))
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && isLan(entry.address))
  // Wi-Fi and Ethernet first; bridges, VPNs and virtual adapters last.
  const virtual = /^(utun|bridge|vmnet|vnic|docker|veth|br-|awdl|llw|ap)/
  return (found.find((entry) => !virtual.test(entry.name)) ?? found[0])?.address
}

const env = { ...process.env }
if (!args.includes('--tunnel') && !env.REACT_NATIVE_PACKAGER_HOSTNAME) {
  const address = lan()
  if (address) {
    env.REACT_NATIVE_PACKAGER_HOSTNAME = address
    console.log(`Using ${address} for the phone (set REACT_NATIVE_PACKAGER_HOSTNAME to override).`)
  }
}
const child = spawn('npx', ['expo', 'start', ...args], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
