// A tunnel Ramu runs for the person, so a host is reachable from anywhere without setting one up by hand. Each kind is
// the provider's own command-line tool, run in the foreground while Ramu listens; the address it prints becomes the
// host's tunnel address. Nothing here is a Ramu service: traffic goes through the person's Cloudflare, Tailscale or
// ngrok, and every call still needs a paired device's token.
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { findExecutable } from '../providers/providerBinaries'
import { userEnvironment } from '../userEnvironment'
import type { NetworkStatus, TunnelChoice } from '@ramu/shared/types'

const TUNNEL_KINDS = ['quick', 'tailscale', 'ngrok'] as const
type TunnelKind = TunnelChoice['kind']
type TunnelTool = 'cloudflared' | 'tailscale' | 'ngrok'
type TunnelStatus = NonNullable<NetworkStatus['tunnel']>

const TOOL: Record<TunnelKind, TunnelTool> = { quick: 'cloudflared', tailscale: 'tailscale', ngrok: 'ngrok' }
/** Waits before starting a tunnel that ended on its own again: soon at first, then less often. */
const RETRY_MS = [3_000, 15_000, 60_000]

/** Checks a choice from a client before it is saved: a known kind, and for ngrok an optional plain domain. */
export function parseTunnelChoice(input: unknown): TunnelChoice | null {
  if (input === null || input === undefined) return null
  const value = input as Partial<TunnelChoice>
  if (typeof value !== 'object' || !TUNNEL_KINDS.includes(value.kind as TunnelKind))
    throw new Error('Choose Cloudflare, Tailscale Funnel or ngrok')
  if (value.kind !== 'ngrok' || value.domain === undefined || value.domain === '') return { kind: value.kind! }
  const domain = String(value.domain)
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain))
    throw new Error('Enter your ngrok domain, such as example.ngrok-free.app')
  return { kind: 'ngrok', domain: domain.toLowerCase() }
}

/** The command that runs a tunnel to `target` (this host's listener), in the foreground. */
export function tunnelCommand(choice: TunnelChoice, target: string): string[] {
  const https = target.startsWith('https:')
  if (choice.kind === 'quick')
    return ['tunnel', '--no-autoupdate', ...(https ? ['--no-tls-verify'] : []), '--url', target]
  if (choice.kind === 'tailscale') return ['funnel', https ? target.replace(/^https:/, 'https+insecure:') : target]
  return [
    'http',
    target,
    '--log',
    'stdout',
    '--log-format',
    'json',
    ...(choice.domain ? ['--url', `https://${choice.domain}`] : []),
  ]
}

/** The public address in one line of a tunnel tool's output, if it names one. */
export function tunnelUrl(kind: TunnelKind, line: string): string | null {
  if (kind === 'quick') return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line)?.[0] ?? null
  if (kind === 'tailscale') return /https:\/\/[a-z0-9.-]+\.ts\.net/i.exec(line)?.[0] ?? null
  try {
    const entry = JSON.parse(line) as { url?: unknown; msg?: unknown }
    return typeof entry.url === 'string' && entry.url.startsWith('https://') ? entry.url.replace(/\/$/, '') : null
  } catch {
    return null
  }
}

/** A tool's own explanation of why it stopped, in its words, for the person to act on. */
function failureOf(kind: TunnelKind, line: string): string | null {
  if (kind === 'ngrok') {
    try {
      const entry = JSON.parse(line) as { lvl?: unknown; err?: unknown }
      return entry.lvl === 'eror' || entry.lvl === 'crit' ? String(entry.err ?? '').trim() || null : null
    } catch {
      return null
    }
  }
  return /\b(error|failed|not enabled|denied|unauthori[sz]ed)\b/i.test(line) ? line.trim().slice(0, 300) : null
}

export class TunnelManager {
  private choice: TunnelChoice | null = null
  private target = ''
  private child?: ChildProcess
  private state: TunnelStatus['state'] = 'off'
  private url: string | null = null
  private error: string | null = null
  private retries = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly options: {
      /** The address changed (it appeared, changed or went away). */
      changed?: () => void
      find?: (command: string) => string | null
      run?: (file: string, args: string[]) => ChildProcess
    } = {},
  ) {}

  /** Runs `choice` to `target`, or stops when either is null. The same choice and target leave a running tunnel alone. */
  use(choice: TunnelChoice | null, target: string | null): void {
    const same =
      JSON.stringify(choice) === JSON.stringify(this.choice) && target === this.target && this.state !== 'failed'
    if (same && (this.child || this.state === 'missing' || !choice)) return
    this.halt()
    this.choice = choice
    this.target = target ?? ''
    this.retries = 0
    this.error = null
    if (!choice || !target) {
      this.state = 'off'
      return
    }
    this.launch()
  }

  status(): TunnelStatus {
    const find = this.options.find ?? findExecutable
    return {
      choice: this.choice,
      state: this.state,
      url: this.url,
      error: this.error,
      tools: {
        cloudflared: !!find('cloudflared'),
        tailscale: !!find('tailscale'),
        ngrok: !!find('ngrok'),
      },
    }
  }

  /** The tunnel's public address while it runs. */
  address(): string | null {
    return this.state === 'running' ? this.url : null
  }

  stop(): void {
    this.halt()
    this.choice = null
    this.state = 'off'
  }

  private setUrl(url: string | null) {
    if (url === this.url) return
    this.url = url
    this.options.changed?.()
  }

  private halt() {
    clearTimeout(this.timer)
    this.timer = undefined
    const child = this.child
    this.child = undefined
    child?.removeAllListeners('exit')
    child?.kill()
    this.setUrl(null)
  }

  private launch() {
    const choice = this.choice!
    const file = (this.options.find ?? findExecutable)(TOOL[choice.kind])
    if (!file) {
      this.state = 'missing'
      this.error = null
      return
    }
    this.state = 'starting'
    const run = this.options.run ?? ((path: string, args: string[]) => spawn(path, args, { env: userEnvironment() }))
    const child = run(file, tunnelCommand(choice, this.target))
    this.child = child
    let lastProblem: string | null = null
    const read = (line: string) => {
      if (this.child !== child) return
      const url = tunnelUrl(choice.kind, line)
      if (url) {
        this.state = 'running'
        this.error = null
        this.retries = 0
        this.setUrl(url)
        return
      }
      lastProblem = failureOf(choice.kind, line) ?? lastProblem
    }
    for (const stream of [child.stdout, child.stderr]) if (stream) createInterface({ input: stream }).on('line', read)
    child.on('error', (error) => {
      lastProblem = error.message
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      this.setUrl(null)
      this.state = 'failed'
      this.error = lastProblem ?? `${TOOL[choice.kind]} stopped (${code ?? 'signal'})`
      // A tunnel that ends on its own is started again, less often each time it fails in a row.
      const wait = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)]!
      this.timer = setTimeout(() => {
        if (this.choice === choice && !this.child) this.launch()
      }, wait)
      this.timer.unref?.()
    })
  }
}
