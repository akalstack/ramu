#!/usr/bin/env node
// `ramu` (also `ramu-server`): runs the Ramu workspace server without the desktop app and controls a running one.
import { runtimeInvoke } from '@ramu/client-runtime'
import { loadConfig, parseListen } from './config'
import { loadToken } from './auth'
import { runtimeVersion } from './build'

const HELP = `ramu — Ramu workspace server (agents, files, Git, terminals, schedules)

Usage:
  ramu [serve] [options]         Run the server in the foreground (default; "start" also works)
  ramu status                    Show whether a server is running for this data directory
  ramu stop                      Stop the running server (unfinished chats are not resumed on next start)
  ramu restart                   Restart the running server (unfinished chats resume)
  ramu token [--rotate]          Print the access token for remote clients; --rotate revokes existing ones

Options:
  --data-dir <dir>               Profile directory (default: the desktop app's, so both share chats and settings)
  --listen <[host:]port>         Also accept authenticated network clients (a bare port binds 127.0.0.1)
  --allow-plaintext-remote       Permit a non-loopback --listen address without TLS (trusted networks only)
  --worktrees <dir>              Where isolated workspaces are created (default: ~/.ramu/worktrees)
  -h, --help   -v, --version

Environment: RAMU_USER_DATA, RAMU_SOCKET, RAMU_LISTEN, RAMU_TOKEN_FILE, RAMU_WORKTREES, RAMU_ALLOW_PLAINTEXT_REMOTE.
Anyone holding the token has the same control as the desktop app, including shell access. Keep it private.`

function fail(message: string): never { console.error(`ramu: ${message}`); process.exit(1) }

const booleans = new Set(['rotate', 'help', 'version', 'allow-plaintext-remote'])
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
if (flags.has('allow-plaintext-remote')) process.env.RAMU_ALLOW_PLAINTEXT_REMOTE = '1'

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
  console.log(loadToken(config.tokenPath, flags.has('rotate')))
  if (flags.has('rotate')) console.error('Previous tokens no longer work.')
} else fail(`unknown command "${command}". Run ramu --help.`)
