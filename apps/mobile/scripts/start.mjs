// Prefer a mesh VPN for phones away from Wi-Fi, then a physical LAN interface.
// Usage: node scripts/start.mjs [--dev-client | --go] [expo start options]
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { devAddresses, devEnvironment } from './dev-addresses.mjs'

const args = process.argv.slice(2)
if (!args.includes('--go') && !args.includes('--dev-client')) args.unshift('--dev-client')
const addresses = devAddresses(networkInterfaces())
const env = devEnvironment(process.env, args, addresses)
if (env.REACT_NATIVE_PACKAGER_HOSTNAME && !args.includes('--tunnel')) {
  console.log(
    `Using ${env.REACT_NATIVE_PACKAGER_HOSTNAME} for the phone (set REACT_NATIVE_PACKAGER_HOSTNAME to override).`,
  )
  if (addresses.length > 1)
    console.log(
      `Other computer addresses: ${addresses.join(', ')}. The phone must have a route to the selected address.`,
    )
}
const child = spawn('npx', ['expo', 'start', ...args], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
