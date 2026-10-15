// Computers reached over SSH: provision `ramu` on the other side, keep an `ssh -L` tunnel to it, and pair through the tunnel.
// System `ssh` does the work, so aliases, keys, agents and ProxyJump from ~/.ssh/config behave as they do in a terminal.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseSshTarget } from '@ramu/contracts'
import type { RemoteServers, SavedServer, SshRoute } from './remoteServers'

export const REMOTE_PORT = 7788
const OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']
const TUNNEL_WAIT_MS = 15_000

/** Aliases from an ssh config. Wildcard and negated patterns are not hosts you can pick. */
export function parseSshConfigHosts(text: string): string[] {
  const hosts = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*Host\s+(.+?)\s*$/i.exec(line)
    if (!match) continue
    for (const name of match[1]!.replace(/#.*$/, '').split(/\s+/)) if (name && !/[*?!]/.test(name) && /^[A-Za-z0-9._-]+$/.test(name)) hosts.add(name)
  }
  return [...hosts]
}

export function listSshHosts(home = homedir()): string[] {
  const read = (path: string) => { try { return existsSync(path) ? readFileSync(path, 'utf8') : '' } catch { return '' } }
  const config = read(join(home, '.ssh', 'config'))
  const included = [...config.matchAll(/^\s*Include\s+(\S+)\s*$/gim)].map((match) => match[1]!).filter((path) => !/[*?]/.test(path)).map((path) => read(path.startsWith('/') ? path : join(home, '.ssh', path.replace(/^~\//, ''))))
  return parseSshConfigHosts([config, ...included].join('\n')).sort((a, b) => a.localeCompare(b))
}

/** Runs on the other computer through `sh -l -s -- <mode> <port> [url]` with no installs: it only finds, starts and asks ramu. */
export const REMOTE_SCRIPT = `
mode="$1"; port="$2"
command -v ramu >/dev/null 2>&1 || { echo '{"state":"missing"}'; exit 0; }
if ! ramu status >/dev/null 2>&1; then
  nohup ramu serve --listen "127.0.0.1:$port" >/dev/null 2>&1 </dev/null &
  i=0; while [ "$i" -lt 40 ]; do ramu status >/dev/null 2>&1 && break; i=$((i+1)); sleep 0.5; done
fi
status=$(ramu status 2>/dev/null) || { echo '{"state":"failed"}'; exit 0; }
listening=$(printf '%s' "$status" | sed -n 's/.*listening \\([^ ]*\\).*/\\1/p')
[ -n "$listening" ] || { echo '{"state":"not-listening"}'; exit 0; }
if [ "$mode" = "ensure" ]; then printf '{"state":"ready","listening":"%s"}\\n' "$listening"; exit 0; fi
addr=$(printf '%s' "$listening" | sed 's/^0\\.0\\.0\\.0:/127.0.0.1:/; s/^\\[::\\]:/127.0.0.1:/')
ramu pair --json --url "http://$addr" 2>/dev/null || echo '{"state":"failed"}'
`

export interface RemoteReport { state: 'ready' | 'missing' | 'failed' | 'not-listening'; listening?: string; code?: string; urls?: string[] }

/** The last JSON line, since login shells may print banners first. */
export function parseRemoteReport(output: string): RemoteReport {
  const line = output.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.startsWith('{')).pop()
  if (!line) throw new Error('The other computer did not answer as expected')
  const report = JSON.parse(line) as RemoteReport & { urls?: string[] }
  return { ...report, state: report.state ?? 'ready' }
}

/** Where the tunnel leads on the other computer: its listen address, with a wildcard bind reached through loopback. */
export function remoteForward(listening: string): string {
  const index = listening.lastIndexOf(':'), port = Number(listening.slice(index + 1))
  let host = listening.slice(0, index).replace(/^\[|\]$/g, '')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The other computer reported an unusable address')
  if (host === '0.0.0.0' || host === '::' || host === '') host = '127.0.0.1'
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export function tunnelArgs(target: string, localPort: number, remote: string): string[] {
  return ['-N', '-T', ...OPTIONS, '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-L', `127.0.0.1:${localPort}:${remote}`, '--', target]
}

/** Turns ssh's complaints into something a person can act on. */
export function explainSshFailure(target: string, stderr: string): string {
  const text = stderr.trim()
  if (/host key verification failed|remote host identification/i.test(text)) return `${target} is not a trusted host yet. Run "ssh ${target}" once in a terminal, accept its key, then try again.`
  if (/permission denied|no more authentication methods/i.test(text)) return `${target} needs key-based login. Add your key to ssh-agent or the host's IdentityFile; Ramu cannot answer password prompts.`
  if (/could not resolve|name or service not known|nodename nor servname/i.test(text)) return `Cannot find ${target}. Check the name or the alias in ~/.ssh/config.`
  if (/connection (timed out|refused)|no route|network is unreachable/i.test(text)) return `Cannot reach ${target}. Check that it is on and that SSH is allowed.`
  return text.split(/\r?\n/).filter(Boolean).pop() || `Cannot connect to ${target} over SSH`
}

type Run = (args: string[], input?: string) => Promise<{ stdout: string; stderr: string; code: number }>
const runSsh: Run = (args, input) => new Promise((resolve) => {
  const child = execFile('ssh', args, { timeout: 90_000, maxBuffer: 1_000_000 }, (error, stdout, stderr) => resolve({ stdout, stderr, code: error ? (typeof error.code === 'number' ? error.code : 255) : 0 }))
  if (input !== undefined) child.stdin?.end(input)
})

const freePort = (preferred?: number) => new Promise<number>((resolve, reject) => {
  const attempt = (port: number) => {
    const probe = createServer()
    probe.once('error', () => port ? attempt(0) : reject(new Error('No free local port for the tunnel')))
    probe.listen(port, '127.0.0.1', () => { const bound = (probe.address() as { port: number }).port; probe.close(() => resolve(bound)) })
  }
  attempt(preferred ?? 0)
})

const accepts = (port: number) => new Promise<boolean>((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})

interface Tunnel { child: ChildProcess | null; port: number; stopped: boolean; timer?: NodeJS.Timeout; failures: number }

export class SshComputers {
  private readonly tunnels = new Map<string, Tunnel>()
  constructor(private readonly servers: RemoteServers, private readonly run: Run = runSsh, private readonly launch: typeof spawn = spawn) {}

  async hosts() { return listSshHosts() }

  /** Starts ramu on the other computer if needed and returns what it reported. */
  async provision(target: string, mode: 'pair' | 'ensure'): Promise<RemoteReport> {
    const safe = parseSshTarget(target)
    const { stdout, stderr, code } = await this.run([...OPTIONS, '-T', '--', safe, 'sh', '-l', '-s', '--', mode, String(REMOTE_PORT)], REMOTE_SCRIPT)
    if (code !== 0 && !stdout.includes('{')) throw new Error(explainSshFailure(safe, stderr))
    const report = parseRemoteReport(stdout)
    if (report.state === 'missing') throw new Error(`Ramu is not installed on ${safe}, or "ramu" is not on the PATH of a non-interactive SSH login. Install it there and try again.`)
    if (report.state === 'failed') throw new Error(`Ramu could not start on ${safe}. Run "ramu serve --listen 127.0.0.1:${REMOTE_PORT}" there to see why.`)
    if (report.state === 'not-listening') throw new Error(`Ramu is running on ${safe} without network access. Restart it there with --listen 127.0.0.1:${REMOTE_PORT}.`)
    if (report.urls?.some((url) => url.startsWith('https:'))) throw new Error(`${safe} serves HTTPS, which does not fit through an SSH tunnel. Add it by address instead.`)
    return report
  }

  /** Opens the tunnel and resolves with its local port once it accepts connections. */
  async open(id: string, target: string, remote: string, preferredPort?: number): Promise<number> {
    this.close(id)
    const tunnel: Tunnel = { child: null, port: await freePort(preferredPort), stopped: false, failures: 0 }
    this.tunnels.set(id, tunnel)
    try { await this.spawnTunnel(tunnel, target, remote) } catch (error) { this.close(id); throw error }
    return tunnel.port
  }

  /** First connection: start ramu over there, open a tunnel and trade a fresh code for a token through it. */
  async connect(target: string, deviceName: string, pair: (url: string, code: string, deviceName: string) => Promise<{ token: string }>): Promise<{ token: string; url: string; route: SshRoute; release: (id: string) => void; discard: () => void }> {
    const safe = parseSshTarget(target)
    const report = await this.provision(safe, 'pair')
    if (!report.code || !report.listening) throw new Error(`${safe} did not create a pairing code`)
    const remote = remoteForward(report.listening), pending = `pending:${safe}`
    const port = await this.open(pending, safe, remote)
    const url = `http://127.0.0.1:${port}`
    try {
      const { token } = await pair(url, report.code, deviceName)
      return { token, url, route: { target: safe, remote }, release: (id) => this.rename(pending, id), discard: () => this.close(pending) }
    } catch (error) { this.close(pending); throw error }
  }

  private rename(from: string, to: string) { const tunnel = this.tunnels.get(from); if (tunnel) { this.tunnels.delete(from); this.tunnels.set(to, tunnel) } }

  /** For a saved computer: make sure ramu is running over there, then the tunnel is up. The URL follows the tunnel's port. */
  async ensure(id: string, saved: SavedServer): Promise<void> {
    if (!saved.ssh) return
    const live = this.tunnels.get(id)
    if (live && !live.stopped && live.child?.exitCode === null && await accepts(live.port)) return
    const report = await this.provision(saved.ssh.target, 'ensure')
    const port = await this.open(id, saved.ssh.target, remoteForward(report.listening!), Number(new URL(saved.url).port) || undefined)
    if (new URL(saved.url).port !== String(port)) this.servers.setUrl(id, `http://127.0.0.1:${port}`)
  }

  /** Spawns ssh and waits for the forward; later drops restart it on the same local port. */
  private spawnTunnel(tunnel: Tunnel, target: string, remote: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let stderr = '', ready = false
      const child = this.launch('ssh', tunnelArgs(target, tunnel.port, remote), { stdio: ['ignore', 'ignore', 'pipe'] })
      tunnel.child = child
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000) })
      const deadline = Date.now() + TUNNEL_WAIT_MS
      const poll = async () => {
        while (!ready && !tunnel.stopped && child.exitCode === null && Date.now() < deadline) {
          if (await accepts(tunnel.port)) { ready = true; tunnel.failures = 0; resolve(); return }
          await new Promise((wake) => setTimeout(wake, 150))
        }
        if (!ready) { child.kill(); reject(new Error(explainSshFailure(target, stderr) || `The SSH tunnel to ${target} did not open`)) }
      }
      void poll()
      child.once('exit', () => {
        if (tunnel.stopped) return
        if (!ready) return
        tunnel.failures += 1
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(tunnel.failures, 5))
        tunnel.timer = setTimeout(() => { if (!tunnel.stopped) void this.spawnTunnel(tunnel, target, remote).catch(() => {}) }, delay)
      })
    })
  }

  close(id: string) {
    const tunnel = this.tunnels.get(id)
    if (!tunnel) return
    tunnel.stopped = true; clearTimeout(tunnel.timer); tunnel.child?.kill()
    this.tunnels.delete(id)
  }

  closeAll() { for (const id of [...this.tunnels.keys()]) this.close(id) }
}
