#!/usr/bin/env node
// `ramu` (also `ramu-server`): runs the Ramu workspace server without the desktop app and controls a running one.
import { runtimeInvoke } from '@ramu/client-runtime'
import type { NetworkStatus } from '@ramu/shared/types/remote'
import { loadConfig, parseListen } from './config'
import { loadToken } from './remote/auth'
import { runtimeVersion } from './build'
import { DeviceStore, PAIRING_TTL_MS } from './remote/devices'
import { candidateUrls } from './remote/network'
import { encodePairLink, parseRemoteUrl } from '@ramu/contracts'

const HELP = `ramu — Ramu workspace server (agents, files, Git, terminals, schedules)

Usage:
  ramu [serve] [options]         Run the server in the foreground (default; "start" also works)
  ramu status                    Show whether a server is running for this data directory
  ramu stop                      Stop the running server (unfinished threads are not resumed on next start)
  ramu restart                   Restart the running server (unfinished threads resume)
  ramu browser status|setup|stop  Inspect, provision or stop the host browser on this computer
  ramu browser threads|grants     List thread IDs or current browser device grants
  ramu browser grant <device> <thread>
                                 Grant a paired owner device one hour of browser viewing/control and scoped transfers
  ramu browser revoke <device> <thread>
                                 Revoke that device/thread grant and pause its control
  ramu pair [--url <address>] [--role owner|viewer] [--json]
                                 Create a one-time code and link to pair another device (valid 10 minutes, works once).
                                 --json prints { code, expiresAt, links, urls, listening } for scripts and SSH pairing.
  ramu devices                   List paired devices
  ramu devices revoke <id|all>   Revoke one paired device, or all of them
  ramu devices offers            List unused pairing offers (never their codes)
  ramu devices cancel <offer>    Withdraw an unused pairing offer
  ramu token [--rotate]          Print the shared access token; --rotate revokes it and every paired device

Options:
  --data-dir <dir>               Profile directory (default: the desktop app's, so both share threads and settings)
  --listen <[host:]port>         Also accept authenticated network clients (a bare port binds 127.0.0.1)
  --private-network              Permit a non-loopback --listen address without TLS when every device that can reach it is
                                 on a network you trust, such as a VPN (Tailscale, NetBird, ZeroTier, WireGuard) or a LAN.
                                 (--allow-plaintext-remote is the same flag.)
  --discoverable                 With --listen: let devices on the same network see this host's name and find it when pairing
                                 (off by default; Settings controls it otherwise). Nothing is advertised on loopback.
  --tls-cert <file> --tls-key <file>
                                 Serve the network listener over HTTPS (for example a certificate from your VPN or a proxy)
  --url <address>                With "pair": the address the other device should use, such as a VPN hostname
  --worktrees <dir>              Where isolated workspaces are created (default: ~/.ramu/worktrees)
  -h, --help   -v, --version

Environment: RAMU_USER_DATA, RAMU_SOCKET, RAMU_LISTEN, RAMU_TOKEN_FILE, RAMU_DEVICES_FILE, RAMU_WORKTREES,
             RAMU_ALLOW_PLAINTEXT_REMOTE, RAMU_DISCOVERABLE, RAMU_TLS_CERT, RAMU_TLS_KEY, RAMU_DEVICE_TOKEN_DAYS (90 or never),
             RAMU_ALLOW_LEGACY_TOKEN (1 to opt in), RAMU_BROWSER_ORIGINS (comma-separated exact origins),
             RAMU_BROWSER_EXECUTABLE (optional host Chromium executable; Setup checks its sandbox).
A paired device has the same control as the desktop app, including shell access. Pair only devices you own.`

/**
 * Nearby devices that chose this host ask here; each shows a six-digit number, and only a matching one is allowed.
 * Ends when the offer is used or expires. Ctrl-C leaves the code valid until it expires.
 */
async function answerNearby(offerId: string) {
  const { createInterface } = await import('node:readline/promises')
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  console.log('\nOr choose this host under Nearby hosts on the other device. Waiting for it… (Ctrl-C to stop)')
  const answered = new Set<string>()
  try {
    for (;;) {
      const offer = await runtimeInvoke(config.socketPath, 'network.offer', [offerId])
      if (offer.state === 'redeemed') {
        console.log(`Paired ${offer.device?.name ?? 'the device'}.`)
        return
      }
      if (offer.state !== 'pending') {
        console.log('The pairing code expired. Run ramu pair again.')
        return
      }
      const status = (await runtimeInvoke(config.socketPath, 'network.status')) as NetworkStatus
      const request = status.requests?.find((entry) => !answered.has(entry.id))
      if (!request) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      answered.add(request.id)
      const reply = await prompt.question(
        `\n${request.name || 'A device'} (${request.address}) wants to pair and shows ${request.code}. Allow? [y/N] `,
      )
      if (/^y(es)?$/i.test(reply.trim()))
        await runtimeInvoke(config.socketPath, 'network.approveRequest', [request.id, offerId]).catch((error) =>
          console.log(error instanceof Error ? error.message : String(error)),
        )
      else await runtimeInvoke(config.socketPath, 'network.denyRequest', [request.id]).catch(() => {})
    }
  } finally {
    prompt.close()
  }
}

function fail(message: string): never {
  console.error(`ramu: ${message}`)
  process.exit(1)
}

const booleans = new Set([
  'json',
  'rotate',
  'help',
  'version',
  'allow-plaintext-remote',
  'private-network',
  'discoverable',
])
const flags = new Map<string, string | true>()
const positional: string[] = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (arg === '-h') flags.set('help', true)
  else if (arg === '-v') flags.set('version', true)
  else if (!arg.startsWith('--')) positional.push(arg)
  else if (booleans.has(arg.slice(2))) flags.set(arg.slice(2), true)
  else {
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`)
    flags.set(arg.slice(2), value)
  }
}
const text = (name: string) => {
  const value = flags.get(name)
  return typeof value === 'string' ? value : undefined
}

if (flags.has('help')) {
  console.log(HELP)
  process.exit(0)
}
if (flags.has('version')) {
  console.log(runtimeVersion(process.argv[1] ?? ''))
  process.exit(0)
}
const dataDir = text('data-dir'),
  listen = text('listen'),
  worktrees = text('worktrees')
if (dataDir) process.env.RAMU_USER_DATA = dataDir
if (worktrees) process.env.RAMU_WORKTREES = worktrees
if (listen) {
  try {
    parseListen(listen)
  } catch (error) {
    fail((error as Error).message)
  }
  process.env.RAMU_LISTEN = listen
}
if (flags.has('allow-plaintext-remote') || flags.has('private-network')) process.env.RAMU_ALLOW_PLAINTEXT_REMOTE = '1'
if (flags.has('discoverable')) process.env.RAMU_DISCOVERABLE = '1'
if (text('tls-cert')) process.env.RAMU_TLS_CERT = text('tls-cert')
if (text('tls-key')) process.env.RAMU_TLS_KEY = text('tls-key')

const command = positional[0] === 'serve' ? 'start' : (positional[0] ?? 'start')
let config: ReturnType<typeof loadConfig>
try {
  config = loadConfig()
} catch (error) {
  fail((error as Error).message)
}

if (command === 'start') {
  // The server module starts itself on import and exits the process when it stops.
  await import('./index')
} else if (command === 'status') {
  try {
    const status = await runtimeInvoke(config.socketPath, 'background.status')
    console.log(
      `running  pid ${status.pid}  version ${status.version ?? 'unknown'}  protocol ${status.protocol ?? 1}${status.listening ? `  listening ${status.listening}` : ''}`,
    )
  } catch {
    console.log('not running')
    process.exit(3)
  }
} else if (command === 'stop' || command === 'restart') {
  try {
    await runtimeInvoke(config.socketPath, `background.${command}`)
    console.log(command === 'stop' ? 'stopping' : 'restarting')
  } catch {
    console.error('ramu is not running')
    process.exit(3)
  }
} else if (command === 'token') {
  const rotate = flags.has('rotate')
  console.log(loadToken(config.tokenPath, rotate))
  if (rotate) {
    new DeviceStore(config.devicesPath, config.deviceLifetimeMs).revoke('all')
    console.error('The previous token and every paired device no longer work.')
  }
} else if (command === 'pair') {
  const given = text('url')
  let urls: { url: string; note: string }[] = []
  if (given) {
    try {
      urls = [{ url: parseRemoteUrl(given), note: '' }]
    } catch (error) {
      fail((error as Error).message)
    }
  } else {
    const status = await runtimeInvoke(config.socketPath, 'background.status').catch(() => null)
    if (!status) fail('ramu is not running. Start it with --listen, or pass --url <address> if it is on another host.')
    if (!status.listening)
      fail(
        'ramu is not accepting network clients. Restart it with --listen <host:port> (see --help), or pass --url <address>.',
      )
    const [host, port] = [
      status.listening.slice(0, status.listening.lastIndexOf(':')),
      Number(status.listening.slice(status.listening.lastIndexOf(':') + 1)),
    ]
    urls = candidateUrls(host, port, Boolean(status.tls)).map((c) => ({ url: c.url, note: `  (${c.interface})` }))
    if (!urls.length) fail('No network address found for this host. Pass --url <address>.')
  }
  const role = text('role') ?? 'owner'
  if (role !== 'owner' && role !== 'viewer') fail('Role must be owner or viewer')
  // A running server opens the offer itself, so it also advertises nearby and accepts requests while the offer lasts.
  const running = await runtimeInvoke(config.socketPath, 'network.pair', [role]).catch(() => null)
  const { code, offerId } =
    running ?? new DeviceStore(config.devicesPath, config.deviceLifetimeMs).createCode(Date.now(), role)
  const expiresAt = running?.expiresAt ?? Date.now() + PAIRING_TTL_MS
  const links = urls.map(({ url }) => encodePairLink({ url, code, expiresAt }))
  if (flags.has('json')) {
    const status = await runtimeInvoke(config.socketPath, 'background.status').catch(() => null)
    console.log(
      JSON.stringify({
        offerId,
        code,
        expiresAt,
        urls: urls.map(({ url }) => url),
        links,
        listening: status?.listening ?? null,
      }),
    )
    process.exit(0)
  }
  console.log(`Pairing code  ${code}   (works once, expires in ${Math.round(PAIRING_TTL_MS / 60000)} minutes)\n`)
  console.log(`The other device must reach this host at${urls.length > 1 ? ' one of' : ''}:`)
  for (const { url, note } of urls) console.log(`  ${url}${note}`)
  console.log(`\nOr open this link on a device that has Ramu:\n  ${links[0]}`)
  console.log(
    `\nOn that device, send the code to <address>/pair, which returns its own token:\n  curl -s -X POST <address>/pair -H 'Content-Type: application/json' -d '{"code":"${code}","name":"My laptop"}'`,
  )
  if (running && process.stdin.isTTY) await answerNearby(offerId)
} else if (command === 'browser') {
  const action = positional[1] ?? 'status'
  try {
    if (action === 'status')
      console.log(JSON.stringify(await runtimeInvoke(config.socketPath, 'hostBrowser.status'), null, 2))
    else if (action === 'setup') {
      console.log('Setting up sandboxed Chromium on this host. A compatible runtime is downloaded if needed.')
      await runtimeInvoke(config.socketPath, 'hostBrowser.setup')
      console.log('Host browser ready. No website was opened. Use browser grant <device> <thread> for remote viewing.')
    } else if (action === 'stop') {
      await runtimeInvoke(config.socketPath, 'hostBrowser.disable')
      console.log('Host browser stopped; device grants revoked.')
    } else if (action === 'threads')
      for (const task of await runtimeInvoke(config.socketPath, 'tasks.list')) console.log(`${task.id}  ${task.title}`)
    else if (action === 'grants')
      console.log(JSON.stringify(await runtimeInvoke(config.socketPath, 'hostBrowser.grants'), null, 2))
    else if (action === 'grant' || action === 'revoke') {
      const device = positional[2],
        task = positional[3]
      if (!device || !task) fail(`Usage: ramu browser ${action} <device> <thread>`)
      await runtimeInvoke(config.socketPath, action === 'grant' ? 'hostBrowser.grant' : 'hostBrowser.revoke', [
        device,
        task,
      ])
      console.log(
        action === 'grant'
          ? 'Browser access granted for one hour to this device/thread only.'
          : 'Browser access revoked.',
      )
    } else fail(`Unknown browser command ${action}. Run ramu --help.`)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
} else if (command === 'devices') {
  const store = new DeviceStore(config.devicesPath, config.deviceLifetimeMs)
  if (positional[1] === 'revoke') {
    if (!positional[2]) fail('Usage: ramu devices revoke <id|all>')
    let revoked: ReturnType<DeviceStore['revoke']> = []
    try {
      revoked = store.revoke(positional[2])
    } catch (error) {
      fail((error as Error).message)
    }
    if (!revoked.length) fail(`No paired device matches "${positional[2]}". Run ramu devices.`)
    for (const device of revoked) console.log(`Revoked ${device.id}  ${device.name}`)
  } else if (positional[1] === 'offers') {
    const offers = store.offers()
    if (!offers.length) console.log('No unused pairing offers.')
    for (const offer of offers)
      console.log(`${offer.id}  ${offer.role.padEnd(6)}  expires ${new Date(offer.expiresAt).toLocaleString()}`)
  } else if (positional[1] === 'cancel') {
    if (!positional[2]) fail('Usage: ramu devices cancel <offer>')
    if (!store.cancelOffer(positional[2])) fail(`No unused pairing offer "${positional[2]}". Run ramu devices offers.`)
    console.log(`Cancelled offer ${positional[2]}`)
  } else if (positional[1])
    fail(
      `unknown devices command "${positional[1]}". Use ramu devices, ramu devices revoke <id|all>, offers or cancel <offer>.`,
    )
  else {
    const devices = store.list()
    if (!devices.length) console.log('No paired devices. Run ramu pair.')
    const ago = (time: number | null) => (time ? new Date(time).toLocaleString() : 'never')
    for (const device of devices)
      console.log(
        `${device.id}  ${device.name.padEnd(24)}  paired ${ago(device.createdAt)}  last seen ${ago(device.lastSeenAt)}  ${device.role}  expires ${ago(device.expiresAt)}`,
      )
  }
} else fail(`unknown command "${command}". Run ramu --help.`)
