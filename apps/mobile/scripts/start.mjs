// One Metro server for every LAN/VPN interface; each phone keeps the address it connected through.
// Usage: node scripts/start.mjs [--dev-client | --go] [expo start options]
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { readFileSync } from 'node:fs'
import { devAddresses, devEnvironment, publishesLocalAddresses } from './dev-addresses.mjs'
import { devPort, withDevPort, devLaunchLinks } from './dev-server.mjs'

const args = process.argv.slice(2)
if (!args.includes('--go') && !args.includes('--dev-client')) args.unshift('--dev-client')
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo
const schemeIndex = args.indexOf('--scheme')
const scheme = args.includes('--go')
  ? 'exp'
  : ((schemeIndex >= 0 ? args[schemeIndex + 1] : args.find((arg) => arg.startsWith('--scheme='))?.slice(9)) ??
    `exp+${app.slug}`)
const addresses = devAddresses(networkInterfaces())
const env = devEnvironment(process.env, args, addresses)
const publish = publishesLocalAddresses(process.env, args)
let port
try {
  port = await devPort(args, env)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
let last = ''
const announce = () => {
  const links = devLaunchLinks(devAddresses(networkInterfaces()), port, scheme)
  const next = links.join('\n')
  if (next === last) return
  last = next
  console.log('\nOpen Ramu on your phone using any reachable address (once Metro is ready):')
  for (const link of links) console.log(`  ${link}`)
  console.log('Nearby discovery is enabled unless explicitly disabled; VPN peers can use these links.\n')
}
if (publish) announce()
const child = spawn('npx', ['expo', 'start', ...withDevPort(args, port)], { stdio: 'inherit', env })
const watch = publish ? setInterval(announce, 5000) : undefined
child.on('error', (error) => {
  clearInterval(watch)
  console.error(error.message)
  process.exit(1)
})
child.on('exit', (code) => {
  clearInterval(watch)
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
