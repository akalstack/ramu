#!/usr/bin/env node
// `ramu` (also `ramu-server`): runs the Ramu workspace server without the desktop app and controls a running one.
import { runtimeInvoke } from '@ramu/client-runtime'
import { loadConfig, parseListen } from './config'
import { loadToken } from './auth'
import { runtimeVersion } from './build'
import { DeviceStore, PAIRING_TTL_MS } from './devices'
import { candidateUrls } from './network'
import { parseRemoteUrl } from '@ramu/contracts'

const HELP = `ramu — Ramu workspace server (agents, files, Git, terminals, schedules)

Usage:
  ramu [serve] [options]         Run the server in the foreground (default; "start" also works)
  ramu status                    Show whether a server is running for this data directory
  ramu stop                      Stop the running server (unfinished chats are not resumed on next start)
  ramu restart                   Restart the running server (unfinished chats resume)
  ramu pair [--url <address>]
                                 Create a one-time code to pair another device (valid 10 minutes, works once)
  ramu devices                   List paired devices
  ramu devices revoke <id|all>   Revoke one paired device, or all of them
  ramu token [--rotate]          Print the shared access token; --rotate revokes it and every paired device

Options:
  --data-dir <dir>               Profile directory (default: the desktop app's, so both share chats and settings)
  --listen <[host:]port>         Also accept authenticated network clients (a bare port binds 127.0.0.1)
  --private-network              Permit a non-loopback --listen address without TLS when every device that can reach it is
                                 on a network you trust, such as a VPN (Tailscale, NetBird, ZeroTier, WireGuard) or a LAN.
                                 (--allow-plaintext-remote is the same flag.)
  --tls-cert <file> --tls-key <file>
                                 Serve the network listener over HTTPS (for example a certificate from your VPN or a proxy)
  --url <address>                With "pair": the address the other device should use, such as a VPN hostname
  --worktrees <dir>              Where isolated workspaces are created (default: ~/.ramu/worktrees)
  -h, --help   -v, --version

Environment: RAMU_USER_DATA, RAMU_SOCKET, RAMU_LISTEN, RAMU_TOKEN_FILE, RAMU_DEVICES_FILE, RAMU_WORKTREES,
             RAMU_ALLOW_PLAINTEXT_REMOTE, RAMU_TLS_CERT, RAMU_TLS_KEY.
A paired device has the same control as the desktop app, including shell access. Pair only devices you own.`

function fail(message: string): never { console.error(`ramu: ${message}`); process.exit(1) }

const booleans = new Set(['rotate', 'help', 'version', 'allow-plaintext-remote', 'private-network'])
const flags = new Map<string, string | true>()
const positional: string[] = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (arg === '-h') flags.set('help', true)
  else if (arg === '-v') flags.set('version', true)
  else if (!arg.startsWith('--')) positional.push(arg)
  else if (booleans.has(arg.slice(2))) flags.set(arg.slice(2), true)
  else { const value = argv[++i]; if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`); flags.set(arg.slice(2), value) }
}
const text = (name: string) => { const value = flags.get(name); return typeof value === 'string' ? value : undefined }

if (flags.has('help')) { console.log(HELP); process.exit(0) }
if (flags.has('version')) { console.log(runtimeVersion(process.argv[1] ?? '')); process.exit(0) }
const dataDir = text('data-dir'), listen = text('listen'), worktrees = text('worktrees')
if (dataDir) process.env.RAMU_USER_DATA = dataDir
if (worktrees) process.env.RAMU_WORKTREES = worktrees
if (listen) { try { parseListen(listen) } catch (error) { fail((error as Error).message) }; process.env.RAMU_LISTEN = listen }
if (flags.has('allow-plaintext-remote') || flags.has('private-network')) process.env.RAMU_ALLOW_PLAINTEXT_REMOTE = '1'
if (text('tls-cert')) process.env.RAMU_TLS_CERT = text('tls-cert')
if (text('tls-key')) process.env.RAMU_TLS_KEY = text('tls-key')

const command = positional[0] === 'serve' ? 'start' : positional[0] ?? 'start'
let config: ReturnType<typeof loadConfig>
try { config = loadConfig() } catch (error) { fail((error as Error).message) }

if (command === 'start') {
  // The server module starts itself on import and exits the process when it stops.
  await import('./index')
} else if (command === 'status') {
  try {
    const status = await runtimeInvoke(config.socketPath, 'background.status')
    console.log(`running  pid ${status.pid}  version ${status.version ?? 'unknown'}  protocol ${status.protocol ?? 1}${status.listening ? `  listening ${status.listening}` : ''}`)
  } catch { console.log('not running'); process.exit(3) }
} else if (command === 'stop' || command === 'restart') {
  try { await runtimeInvoke(config.socketPath, `background.${command}`); console.log(command === 'stop' ? 'stopping' : 'restarting') }
  catch { console.error('ramu is not running'); process.exit(3) }
} else if (command === 'token') {
  const rotate = flags.has('rotate')
  console.log(loadToken(config.tokenPath, rotate))
  if (rotate) { new DeviceStore(config.devicesPath).revoke('all'); console.error('The previous token and every paired device no longer work.') }
} else if (command === 'pair') {
  const given = text('url')
  let urls: { url: string; note: string }[] = []
  if (given) { try { urls = [{ url: parseRemoteUrl(given), note: '' }] } catch (error) { fail((error as Error).message) } }
  else {
    const status = await runtimeInvoke(config.socketPath, 'background.status').catch(() => null)
    if (!status) fail('ramu is not running. Start it with --listen, or pass --url <address> if it is on another computer.')
    if (!status.listening) fail('ramu is not accepting network clients. Restart it with --listen <host:port> (see --help), or pass --url <address>.')
    const [host, port] = [status.listening.slice(0, status.listening.lastIndexOf(':')), Number(status.listening.slice(status.listening.lastIndexOf(':') + 1))]
    urls = candidateUrls(host, port, Boolean(status.tls)).map((c) => ({ url: c.url, note: `  (${c.interface})` }))
    if (!urls.length) fail('No network address found for this computer. Pass --url <address>.')
  }
  const { code } = new DeviceStore(config.devicesPath).createCode()
  console.log(`Pairing code  ${code}   (works once, expires in ${Math.round(PAIRING_TTL_MS / 60000)} minutes)\n`)
  console.log(`The other device must reach this computer at${urls.length > 1 ? ' one of' : ''}:`)
  for (const { url, note } of urls) console.log(`  ${url}${note}`)
  console.log(`\nOn that device, send the code to <address>/pair, which returns its own token:\n  curl -s -X POST <address>/pair -H 'Content-Type: application/json' -d '{"code":"${code}","name":"My laptop"}'`)
} else if (command === 'devices') {
  const store = new DeviceStore(config.devicesPath)
  if (positional[1] === 'revoke') {
    if (!positional[2]) fail('Usage: ramu devices revoke <id|all>')
    let revoked: ReturnType<DeviceStore['revoke']> = []
    try { revoked = store.revoke(positional[2]) } catch (error) { fail((error as Error).message) }
    if (!revoked.length) fail(`No paired device matches "${positional[2]}". Run ramu devices.`)
    for (const device of revoked) console.log(`Revoked ${device.id}  ${device.name}`)
  } else if (positional[1]) fail(`unknown devices command "${positional[1]}". Use ramu devices or ramu devices revoke <id|all>.`)
  else {
    const devices = store.list()
    if (!devices.length) console.log('No paired devices. Run ramu pair.')
    const ago = (time: number | null) => time ? new Date(time).toLocaleString() : 'never'
    for (const device of devices) console.log(`${device.id}  ${device.name.padEnd(24)}  paired ${ago(device.createdAt)}  last seen ${ago(device.lastSeenAt)}`)
  }
} else fail(`unknown command "${command}". Run ramu --help.`)
