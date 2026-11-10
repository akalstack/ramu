#!/usr/bin/env node
// `ramu` (also `ramu-server`): runs the Ramu workspace server without the desktop app and controls a running one.
import { runtimeInvoke } from '@ramu/client-runtime'
import type { AgentHostSummary, NetworkStatus } from '@ramu/shared/types/remote'
import {
  DEVICE_PERMISSIONS,
  PERMISSION_DURATIONS,
  PERMISSION_LABEL,
  grantFor,
  isDevicePermission,
  type PermissionDuration,
} from '@ramu/shared/devicePermissions'
import { loadConfig, parseListen } from './config'
import { runtimeVersion } from './build'
import { DeviceStore, isHostAccess, PAIRING_TTL_MS } from './remote/devices'
import { candidateUrls, DEFAULT_NETWORK_PORT, parsePublicUrl } from './remote/network'
import { installUserService } from './userService'
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
  ramu pair --approve <request> [--role owner|viewer]   ramu pair --deny <request>
                                 Answer a nearby device's request; the server prints each one with its six-digit code.
  ramu devices                   List paired devices
  ramu devices revoke <id|all>   Revoke one paired device, or all of them
  ramu devices allow <id> <permission> [once|hour|day|always]
                                 Let a device use computer, browser, terminal or settings
  ramu devices deny <id> <permission>
                                 Take a permission away
  ramu devices never <id> <permission>
                                 Take it away and refuse that device's requests for it until you allow it again
  ramu devices access <id> <edits|auto|full>
                                 The most access threads a paired host starts here may have (default edits)
  ramu devices offers            List unused pairing offers (never their codes)
  ramu devices cancel <offer>    Withdraw an unused pairing offer
  ramu thread start --project <name> [--title <t>] [--as <name>] <prompt>
                                 Start a thread here at Allow edits, labelled Started from a terminal by <name>
  ramu thread status [<id>] [--wait] [--json]
                                 Threads terminals started here; --wait blocks until that thread settles
  ramu thread message <id> <text>
                                 Queue a message for a thread a terminal started
  ramu thread list [--json]      Same as status with no id
  ramu hosts                     List other hosts this host's agents may start threads on
  ramu hosts add <address> <code> [--name <name>]
                                 Add one, with a code from \`ramu pair\` there; it may only start and follow threads
  ramu hosts forget <id|name>    Stop using a host here (revoke it on that host to end it there too)
  ramu tunnel quick|tailscale|ngrok [domain]|off
                                 Reach this host from anywhere through a tunnel Ramu runs: Cloudflare's quick tunnel (no
                                 account), Tailscale Funnel, or ngrok (with your static domain). Turns on access for this
                                 computer only if it is off. ramu tunnel alone shows its state and address.
  ramu account login|status|logout
                                 Sign this host in to the optional Ramu account with a code confirmed in any browser
  ramu plugin new <name> [--mcp] [--cli]
                                 Write a working plugin folder (manifest, a skill, a README) to build on
  ramu plugin check [folder] [--json]
                                 Validate a plugin: manifest, skills, MCP servers and their tools, ability mappings
  ramu plugin dev [folder]       Install a folder as a Development plugin here; it reloads when its files change
  ramu up [--private-network] [--no-private-network] [--yes]
                                 Set up how other devices reach this host, keep it running as a service, and pair one.
                                 Without a terminal it never asks; pass --private-network (or --yes).

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
  --public-url <https://…>       The address of your own tunnel to this host (cloudflared, Tailscale Funnel, ngrok). Paired
                                 devices and webhook senders try it first; Settings controls it otherwise.
  --url <address>                With "pair": the address the other device should use, such as a VPN hostname
  --worktrees <dir>              Where isolated workspaces are created (default: ~/.ramu/worktrees)
  -h, --help   -v, --version

Environment: RAMU_USER_DATA, RAMU_SOCKET, RAMU_LISTEN, RAMU_DEVICES_FILE, RAMU_WORKTREES,
             RAMU_ALLOW_PLAINTEXT_REMOTE, RAMU_DISCOVERABLE, RAMU_TLS_CERT, RAMU_TLS_KEY, RAMU_PUBLIC_URL,
             RAMU_DEVICE_TOKEN_DAYS (90 or never),
             RAMU_BROWSER_ORIGINS (comma-separated exact origins),
             RAMU_BROWSER_EXECUTABLE (optional host Chromium executable; Setup checks its sandbox).
A paired device has the same control as the desktop app, including shell access. Pair only devices you own.`

/**
 * Nearby devices that chose this host ask here; each shows a six-digit number, and only a matching one is allowed.
 * Ends when the offer is used or expires. Ctrl-C leaves the code valid until it expires.
 */
async function answerNearby(offerId: string, role: 'owner' | 'viewer') {
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
        await runtimeInvoke(config.socketPath, 'network.approveRequest', [request.id, role]).catch((error) =>
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
  'wait',
  'rotate',
  'help',
  'version',
  'allow-plaintext-remote',
  'private-network',
  'discoverable',
  'no-private-network',
  'yes',
  'mcp',
  'cli',
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
const publicUrlFlag = text('public-url')
if (publicUrlFlag) {
  try {
    parsePublicUrl(publicUrlFlag)
  } catch (error) {
    fail((error as Error).message)
  }
  process.env.RAMU_PUBLIC_URL = publicUrlFlag
}

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
    const network = (await runtimeInvoke(config.socketPath, 'network.status').catch(() => null)) as NetworkStatus | null
    if (flags.has('json')) {
      console.log(
        JSON.stringify({
          running: true,
          pid: status.pid,
          version: status.version ?? null,
          listening: status.listening ?? null,
        }),
      )
      process.exit(0)
    }
    console.log(
      `running  pid ${status.pid}  version ${status.version ?? 'unknown'}  protocol ${status.protocol ?? 1}${status.listening ? `  listening ${status.listening}` : ''}`,
    )
    if (network) for (const line of reachLines(network)) console.log(line)
  } catch {
    if (flags.has('json')) console.log(JSON.stringify({ running: false }))
    else console.log('not running')
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
} else if (command === 'pair' && (text('approve') || text('deny'))) {
  // Answers a nearby device's request, as printed by the running server when it arrived.
  const id = (text('approve') ?? text('deny'))!
  const role = text('role') ?? 'owner'
  if (role !== 'owner' && role !== 'viewer') fail('Role must be owner or viewer')
  try {
    if (text('approve')) {
      await runtimeInvoke(config.socketPath, 'network.approveRequest', [id, role])
      console.log(role === 'viewer' ? 'Paired, view only.' : 'Paired, with full access.')
    } else {
      await runtimeInvoke(config.socketPath, 'network.denyRequest', [id])
      console.log('Declined.')
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
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
    if (!status) fail('ramu is not running. Start it with ramu up, or pass --url <address> if it is on another host.')
    const network = (await runtimeInvoke(config.socketPath, 'network.status').catch(() => null)) as NetworkStatus | null
    if (!status.listening && !network?.reachable)
      fail('Nothing can reach this host from another device yet. Run ramu up (see --help), or pass --url <address>.')
    if (status.listening) {
      const [host, port] = [
        status.listening.slice(0, status.listening.lastIndexOf(':')),
        Number(status.listening.slice(status.listening.lastIndexOf(':') + 1)),
      ]
      urls = candidateUrls(host, port, Boolean(status.tls)).map((c) => ({ url: c.url, note: `  (${c.interface})` }))
    }
    const tunnel = network?.publicAddress?.url
    if (tunnel) urls = [{ url: tunnel, note: '  (tunnel)' }, ...urls]
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
  if (running && process.stdin.isTTY) await answerNearby(offerId, role)
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
      await runtimeInvoke(config.socketPath, 'hostBrowser.stop')
      console.log('Host browser stopped; device grants revoked. The next tab starts it again.')
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
  } else if (positional[1] === 'allow' || positional[1] === 'deny' || positional[1] === 'never') {
    // Headless hosts answer permission requests here; Settings → Remote access does the same on a desktop.
    const [, action, deviceId, permission, duration = 'always'] = positional
    if (!deviceId || !isDevicePermission(permission) || !PERMISSION_DURATIONS.includes(duration as PermissionDuration))
      fail(
        `Usage: ramu devices ${action} <id> <${DEVICE_PERMISSIONS.join('|')}>${action === 'allow' ? ' [once|hour|day|always]' : ''}`,
      )
    const choice = action === 'deny' ? 'revoke' : action === 'never' ? 'never' : duration
    const running = await runtimeInvoke(config.socketPath, 'network.setDevicePermission', [
      deviceId,
      permission,
      choice,
    ]).catch(() => null)
    if (!running) {
      if (choice === 'once') fail('“once” lasts until the device disconnects, so it needs the server running.')
      try {
        if (choice === 'never') store.block(deviceId, permission)
        else
          store.setPermission(
            deviceId,
            permission,
            choice === 'revoke' ? null : grantFor(choice as PermissionDuration, Date.now()),
          )
      } catch (error) {
        fail((error as Error).message)
      }
    }
    console.log(
      `${action === 'allow' ? 'Allowed' : action === 'never' ? 'Blocked' : 'Removed'} ${PERMISSION_LABEL[permission]} for ${deviceId}.`,
    )
  } else if (positional[1] === 'access') {
    const [, , deviceId, access] = positional
    if (!deviceId || !isHostAccess(access)) fail('Usage: ramu devices access <id> <edits|auto|full>')
    const running = await runtimeInvoke(config.socketPath, 'network.setHostAccess', [deviceId, access]).catch(
      () => null,
    )
    if (!running)
      try {
        store.setMaxAccess(deviceId, access)
      } catch (error) {
        fail((error as Error).message)
      }
    console.log(`Threads ${deviceId} starts here get at most ${access} access.`)
    if (access !== 'edits')
      console.log(
        "Warning: that host's agent writes what these threads do. If it is compromised, it can run commands here without asking you.",
      )
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
      `unknown devices command "${positional[1]}". Use ramu devices, ramu devices revoke <id|all>, allow, deny, offers or cancel <offer>.`,
    )
  else {
    const devices = store.list()
    if (!devices.length) console.log('No paired devices. Run ramu pair.')
    const ago = (time: number | null) => (time ? new Date(time).toLocaleString() : 'never')
    for (const device of devices) {
      console.log(
        `${device.id}  ${device.name.padEnd(24)}  paired ${ago(device.createdAt)}  last seen ${ago(device.lastSeenAt)}  ${device.role}  expires ${ago(device.expiresAt)}`,
      )
      if (device.kind === 'host')
        console.log(
          `          a paired host: starts and follows threads only, at most ${device.maxAccess ?? 'edits'} access`,
        )
      else if (device.role !== 'viewer') {
        const held = store.permissionsOf(device.id)
        const granted = DEVICE_PERMISSIONS.filter((permission) => held[permission])
        console.log(`          can use: ${granted.length ? granted.join(', ') : 'nothing beyond threads and files'}`)
      }
    }
    const status = (await runtimeInvoke(config.socketPath, 'network.status').catch(() => null)) as NetworkStatus | null
    for (const request of status?.permissionRequests ?? [])
      console.log(
        `\n${request.deviceName} (${request.deviceId}) asks for ${request.permission}. Allow it with: ramu devices allow ${request.deviceId} ${request.permission} [once|hour|day|always]`,
      )
  }
} else if (command === 'thread') {
  const call = <T>(method: string, args: unknown[] = []) =>
    runtimeInvoke(config.socketPath, method, args).catch((error: Error) =>
      fail(
        /ENOENT|ECONNREFUSED/.test(String((error as { code?: string }).code))
          ? 'ramu is not running. Start it first.'
          : error.message,
      ),
    ) as Promise<T>
  type Status = {
    threadId: string
    title: string
    project: string | null
    state: string
    error?: string
    latest?: string
  }
  const print = (value: unknown, lines: () => void) =>
    flags.has('json') ? console.log(JSON.stringify(value, null, 2)) : lines()
  const [, action, ...rest] = positional
  if (action === 'start') {
    const prompt = rest.join(' ').trim()
    const project = text('project')
    if (!prompt || !project) fail('Usage: ramu thread start --project <name> [--title <t>] [--as <name>] <prompt>')
    const started = await call<{ taskId: string; title: string; error?: string }>('terminalThreads.start', [
      {
        prompt,
        project,
        ...(text('title') ? { title: text('title') } : {}),
        ...(text('as') ? { as: text('as') } : {}),
      },
    ])
    if (started.error) fail(started.error)
    print(started, () => console.log(`${started.taskId}  ${started.title}`))
  } else if (action === 'message') {
    const [id, ...words] = rest
    if (!id || !words.length) fail('Usage: ramu thread message <id> <text>')
    print(await call('terminalThreads.message', [id, words.join(' ')]), () => console.log('queued'))
  } else if (action === 'status' || action === 'list' || !action) {
    const id = action === 'status' ? rest[0] : undefined
    const settled = (state: string) => !['running', 'starting', 'needs-input', 'not started'].includes(state)
    let rows = await call<Status[]>('terminalThreads.status', [id ?? null])
    if (id && !rows.length) fail(`No thread a terminal started matches "${id}".`)
    while (flags.has('wait') && id && !settled(rows[0]!.state)) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      rows = await call<Status[]>('terminalThreads.status', [id])
    }
    print(id ? rows[0] : rows, () => {
      for (const row of rows)
        console.log(`${row.threadId}  ${row.state.padEnd(12)}  ${row.title}${row.error ? `  (${row.error})` : ''}`)
      if (id && rows[0]?.latest) console.log(`\n${rows[0].latest}`)
    })
  } else fail(`unknown thread command "${action}". Use start, status, message or list.`)
} else if (command === 'hosts') {
  // Adding a host pairs this host there and stores the token in this host's credential store, so the server does it.
  const call = (method: string, args: unknown[] = []) =>
    runtimeInvoke(config.socketPath, method, args).catch((error: Error) =>
      fail(
        /ENOENT|ECONNREFUSED/.test(String((error as { code?: string }).code))
          ? 'ramu is not running. Start it first.'
          : error.message,
      ),
    ) as Promise<AgentHostSummary[]>
  if (positional[1] === 'add') {
    const [, , address, code] = positional
    if (!address || !code) fail('Usage: ramu hosts add <address> <code> [--name <name>]')
    const hosts = await call('network.addAgentHost', [address, code, text('name')])
    const added = hosts.at(-1)
    console.log(`Added ${added?.name}. Agents here can now start threads there with host "${added?.name}".`)
  } else if (positional[1] === 'forget') {
    const named = positional[2]
    if (!named) fail('Usage: ramu hosts forget <id|name>')
    const host = (await call('network.agentHosts')).find((entry) => entry.id === named || entry.name === named)
    if (!host) fail(`No added host matches "${named}". Run ramu hosts.`)
    await call('network.forgetAgentHost', [host!.id])
    console.log(`Forgot ${host!.name}. Revoke ${host!.deviceId} on that host to end the pairing there too.`)
  } else if (positional[1]) fail(`unknown hosts command "${positional[1]}". Use ramu hosts, ramu hosts add or forget.`)
  else {
    const hosts = await call('network.agentHosts')
    if (!hosts.length)
      console.log('No hosts added. Run ramu pair on the other host, then ramu hosts add <address> <code>.')
    for (const host of hosts)
      console.log(`${host.id.slice(0, 8)}  ${host.name.padEnd(20)}  ${host.address}  device ${host.deviceId} there`)
  }
} else if (command === 'tunnel') {
  const call = (method: string, args: unknown[] = []) =>
    runtimeInvoke(config.socketPath, method, args).catch((error: Error) =>
      fail(
        /ENOENT|ECONNREFUSED/.test(String((error as { code?: string }).code))
          ? 'ramu is not running. Start it first.'
          : error.message,
      ),
    ) as Promise<NetworkStatus>
  const kind = positional[1]
  if (kind && !['quick', 'tailscale', 'ngrok', 'off'].includes(kind))
    fail('Usage: ramu tunnel quick|tailscale|ngrok [domain]|off')
  let status = kind
    ? await call('network.setTunnel', [
        kind === 'off' ? null : { kind, ...(kind === 'ngrok' && positional[2] ? { domain: positional[2] } : {}) },
      ])
    : await call('network.status')
  // The address arrives once the tool has connected, usually within a few seconds.
  for (let wait = 0; kind && kind !== 'off' && status.tunnel?.state === 'starting' && wait < 30; wait++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    status = await call('network.status')
  }
  const tunnel = status.tunnel
  if (!tunnel?.choice) console.log('No tunnel. Devices reach this host on your network or VPN.')
  else if (tunnel.state === 'running') console.log(`Reachable at ${tunnel.url}. Pair a device with ramu pair.`)
  else if (tunnel.state === 'missing')
    console.log(
      `${{ quick: 'cloudflared', tailscale: 'tailscale', ngrok: 'ngrok' }[tunnel.choice.kind]} is not installed. Install it, then run this again.`,
    )
  else console.log(`Tunnel ${tunnel.state}${tunnel.error ? `: ${tunnel.error}` : ''}`)
} else if (command === 'account') {
  const action = positional[1] ?? 'status'
  if (action === 'login') {
    const started = await call<{ userCode: string; verificationUri: string; expiresAt: number }>('account.signIn')
    console.log(`Open ${started.verificationUri} on any device, sign in, and check the code ${started.userCode}.`)
    for (;;) {
      await sleep(3000)
      const status = await call<{ signedIn: boolean; user: { email: string } | null; pendingSignIn: unknown }>(
        'account.status',
      )
      if (status.signedIn) {
        console.log(`Signed in as ${status.user?.email}.`)
        break
      }
      if (!status.pendingSignIn) fail('The sign-in expired or was denied. Run ramu account login again.')
    }
  } else if (action === 'logout') {
    await call('account.signOut')
    console.log('Signed out. This host’s copy of the backup key is gone; your other devices keep theirs.')
  } else if (action === 'status') {
    const status = await call<{
      signedIn: boolean
      user: { email: string } | null
      backup: { account: boolean; github: boolean; lastBackupAt: number | null; error: string | null }
      listed: boolean
    }>('account.status')
    console.log(status.signedIn ? `Signed in as ${status.user?.email}` : 'Not signed in (ramu account login)')
    console.log(
      `Backup: ${[status.backup.account ? 'Ramu account' : null, status.backup.github ? 'your GitHub' : null].filter(Boolean).join(' and ') || 'off'}${status.backup.lastBackupAt ? `, last ${new Date(status.backup.lastBackupAt).toLocaleString()}` : ''}${status.backup.error ? ` (${status.backup.error})` : ''}`,
    )
    console.log(`Listed in Your hosts: ${status.listed ? 'yes' : 'no'}`)
  } else fail('Use ramu account login, ramu account status or ramu account logout.')
} else if (command === 'plugin') {
  const [, action, target] = positional
  if (action === 'new') {
    if (!target) fail('Name the plugin: ramu plugin new <name>')
    const { newPlugin } = await import('./plugins/authoring')
    try {
      const root = newPlugin(process.cwd(), target, { mcp: flags.has('mcp'), cli: flags.has('cli') })
      console.log(
        `Wrote ${root}.\nNext: cd ${target} && ramu plugin dev . to try it in a thread, then ramu plugin check .`,
      )
    } catch (error) {
      fail((error as Error).message)
    }
  } else if (action === 'check') {
    const { checkPlugin } = await import('./plugins/authoring')
    const report = await checkPlugin(target ?? '.')
    if (flags.has('json')) console.log(JSON.stringify(report, null, 2))
    else {
      for (const server of report.servers)
        console.log(`MCP server ${server.name}: ${server.tools.join(', ') || 'no tools'}`)
      if (report.signed !== null)
        console.log(report.signed ? 'The latest commit is signed.' : 'The latest commit is not signed.')
      for (const problem of report.problems) console.error(`${problem.file}: ${problem.message}`)
      console.log(report.problems.length ? `${report.problems.length} problem(s).` : `${report.name} is ready.`)
    }
    process.exit(report.problems.length ? 1 : 0)
  } else if (action === 'dev') {
    const { resolve } = await import('node:path')
    const plugin = await call<{ name: string; credentials: { label: string; state: string }[] }>('plugins.dev', [
      resolve(target ?? '.'),
    ])
    const missing = plugin.credentials.filter((slot) => slot.state !== 'saved').map((slot) => slot.label)
    console.log(
      `${plugin.name} is installed here as a Development plugin and reloads when a file changes.${missing.length ? ` Add ${missing.join(', ')} in Customize → Plugins.` : ''}`,
    )
  } else fail('Use ramu plugin new <name>, ramu plugin check [folder] or ramu plugin dev [folder].')
} else if (command === 'up') {
  await up()
} else fail(`unknown command "${command}". Run ramu --help.`)

function reachLines(network: NetworkStatus): string[] {
  const lines: string[] = []
  if (network.enabled)
    lines.push(`network  ${network.listening ? 'listening' : 'starting'} on ${network.host}:${network.port}`)
  return lines
}

// Function declarations, so the command branches above can use them before this point is reached.
function call<T>(method: string, args: unknown[] = []): Promise<T> {
  return runtimeInvoke(config.socketPath, method, args).catch((error: Error) =>
    fail(
      /ENOENT|ECONNREFUSED/.test(String((error as { code?: string }).code))
        ? 'ramu is not running. Start it with ramu up or ramu serve.'
        : error.message,
    ),
  ) as Promise<T>
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Guided setup for a command-line host, like the desktop's Remote access section in one command. */
async function up() {
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !flags.has('yes')
  const ask = async (question: string, fallback: boolean): Promise<boolean> => {
    if (!interactive) return fallback
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      const reply = (await rl.question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim()
      return reply ? /^y(es)?$/i.test(reply) : fallback
    } finally {
      rl.close()
    }
  }
  const named = (flag: string) => (flags.has(flag) ? true : flags.has(`no-${flag}`) ? false : undefined)
  let wantPrivate = named('private-network') ?? (flags.has('yes') ? true : undefined)

  let running = await runtimeInvoke(config.socketPath, 'background.status').catch(() => null)
  if (!running) {
    if (!(await ask('Ramu is not running. Keep it running in the background on this computer?', true)))
      fail('Start it with ramu serve, then run ramu up again.')
    const outcome = installUserService(process.argv[1] ?? '', text('data-dir'))
    if (!outcome.installed) fail(outcome.reason)
    console.log(`Installed ${outcome.path}`)
    for (let i = 0; i < 30 && !running; i++) {
      await sleep(1000)
      running = await runtimeInvoke(config.socketPath, 'background.status').catch(() => null)
    }
    if (!running) fail('The service did not start. Check journalctl --user -u ramu or Console.app.')
  }

  let status = await call<NetworkStatus>('network.status')
  if (wantPrivate === undefined) {
    if (!interactive && !status.reachable) fail('Name how devices reach this host: --private-network (or --yes).')
    wantPrivate = await ask(
      'Let devices on your private network (Tailscale, WireGuard or a LAN you trust) reach this host?',
      true,
    )
  }

  if (wantPrivate === true && !status.enabled) {
    if (status.source === 'command-line') fail('Network access was set with --listen; change it there.')
    status = await call<NetworkStatus>('network.configure', [
      { enabled: true, host: '0.0.0.0', port: DEFAULT_NETWORK_PORT, acceptUnencrypted: true, discoverable: false },
    ])
    console.log(`Listening on port ${status.port} for devices on your private network.`)
  } else if (wantPrivate === false && status.enabled && status.source !== 'command-line')
    await call('network.configure', [{ ...status, enabled: false, acceptUnencrypted: status.tls ? false : true }])

  status = await call<NetworkStatus>('network.status')
  for (const line of reachLines(status)) console.log(line)
  if (!status.reachable) {
    console.log('Nothing can reach this host from another device yet.')
    return
  }
  const offer = await call<{ code: string; expiresAt: number; urls: { url: string; interface: string }[] }>(
    'network.pair',
  )
  console.log(
    `\nPair a device with code  ${offer.code}  (works once, expires in ${Math.round(PAIRING_TTL_MS / 60000)} minutes)`,
  )
  for (const { url, interface: via } of offer.urls) console.log(`  ${url}  (${via})`)
}
