// Cloudflare Tunnel as a managed child process: a public HTTPS address for this host without opening a port. The
// tunnel's origin is a loopback listener only this module starts, so the network listener's own settings are untouched.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TunnelMode, TunnelStatus } from '@ramu/shared/types/remote'

/** A pinned release; each file is checked against its published SHA-256 before it is ever run. */
const CLOUDFLARED_VERSION = '2026.10.7'
const RELEASES: Partial<Record<string, { file: string; sha256: string; archive: boolean }>> = {
  'darwin-arm64': {
    file: 'cloudflared-darwin-arm64.tgz',
    sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd',
    archive: true,
  },
  'darwin-x64': {
    file: 'cloudflared-darwin-amd64.tgz',
    sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848',
    archive: true,
  },
  'linux-x64': {
    file: 'cloudflared-linux-amd64',
    sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',
    archive: false,
  },
  'linux-arm64': {
    file: 'cloudflared-linux-arm64',
    sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775',
    archive: false,
  },
  'win32-x64': {
    file: 'cloudflared-windows-amd64.exe',
    sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
    archive: false,
  },
}

export interface TunnelSetting {
  mode: TunnelMode
  /** The public address a named tunnel routes to this host, as set up in the Cloudflare dashboard. */
  hostname: string | null
  /** The loopback port the tunnel forwards to; a named tunnel's dashboard route points at it. */
  originPort: number
}
export const DEFAULT_TUNNEL_SETTING: TunnelSetting = { mode: 'off', hostname: null, originPort: 7789 }

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function validateTunnelSetting(input: unknown): TunnelSetting {
  const value = input as Partial<TunnelSetting> | null
  if (!value || typeof value !== 'object') throw new Error('Invalid tunnel settings')
  const mode = value.mode
  if (mode !== 'off' && mode !== 'quick' && mode !== 'named') throw new Error('Invalid tunnel settings')
  const originPort = value.originPort ?? DEFAULT_TUNNEL_SETTING.originPort
  if (!Number.isInteger(originPort) || originPort < 1024 || originPort > 65535)
    throw new Error('Choose a port between 1024 and 65535')
  let hostname: string | null = null
  if (typeof value.hostname === 'string' && value.hostname.trim()) {
    const raw = value.hostname
      .trim()
      .replace(/^https:\/\//i, '')
      .replace(/\/$/, '')
    if (!HOSTNAME.test(raw)) throw new Error('Enter the tunnel’s public hostname, such as ramu.example.com')
    hostname = raw.toLowerCase()
  }
  if (mode === 'named' && !hostname) throw new Error('Enter the public hostname this tunnel routes to')
  return { mode, hostname, originPort }
}

export function readTunnelSetting(path: string): TunnelSetting {
  try {
    return validateTunnelSetting(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_TUNNEL_SETTING }
  }
}
/** The setting, plus the credential-store reference of a named tunnel's token (never the token itself). */
export function writeTunnelSetting(path: string, setting: TunnelSetting, tokenRef: string | null) {
  writeFileSync(path, JSON.stringify({ ...setting, ...(tokenRef ? { tokenRef } : {}) }, null, 2), { mode: 0o600 })
}
export function readTunnelTokenRef(path: string): string | null {
  try {
    const value = (JSON.parse(readFileSync(path, 'utf8')) as { tokenRef?: unknown }).tokenRef
    return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : null
  } catch {
    return null
  }
}

/** The quick tunnel's address, read from cloudflared's log output. */
export const quickTunnelUrl = (text: string) => QUICK_URL.exec(text)?.[0] ?? null

export interface TunnelOptions {
  /** Where a downloaded cloudflared is kept. */
  binDir: string
  /** Starts the loopback origin and resolves once it listens; called before cloudflared. */
  listen(port: number): Promise<void>
  /** Stops it again. */
  unlisten(): void
  /** A named tunnel's token, from the credential store. */
  token(): Promise<string | null>
  changed(): void
  /** Test seam: resolves the executable. */
  resolveBinary?: () => Promise<string>
  spawnProcess?: typeof spawn
}

export class CloudflareTunnel {
  private setting: TunnelSetting = { ...DEFAULT_TUNNEL_SETTING }
  private child: ChildProcess | null = null
  private state: TunnelStatus['state'] = 'off'
  private url: string | null = null
  private error: string | null = null
  private hasToken = false
  private retry: NodeJS.Timeout | undefined
  private attempts = 0
  private generation = 0

  constructor(private readonly options: TunnelOptions) {}

  status(): TunnelStatus {
    return {
      mode: this.setting.mode,
      state: this.state,
      url: this.url,
      error: this.error,
      originPort: this.setting.originPort,
      hostname: this.setting.hostname,
      hasToken: this.hasToken,
    }
  }
  /** The address devices can use right now, or null. */
  address(): string | null {
    return this.state === 'running' ? this.url : null
  }

  setTokenSaved(saved: boolean) {
    this.hasToken = saved
  }

  async apply(setting: TunnelSetting) {
    this.setting = setting
    this.stop()
    if (setting.mode === 'off') return
    await this.start(++this.generation)
  }

  private set(state: TunnelStatus['state'], error: string | null = null) {
    this.state = state
    this.error = error
    this.options.changed()
  }

  private async start(generation: number) {
    try {
      if (this.setting.mode === 'named' && !(await this.options.token()))
        throw new Error('Paste the tunnel token from your Cloudflare dashboard')
      this.set('installing')
      const binary = await (this.options.resolveBinary ?? (() => resolveCloudflared(this.options.binDir)))()
      if (generation !== this.generation) return
      await this.options.listen(this.setting.originPort)
      if (generation !== this.generation) return
      this.set('starting')
      const origin = `http://127.0.0.1:${this.setting.originPort}`
      const env: NodeJS.ProcessEnv = { ...process.env }
      let args: string[]
      if (this.setting.mode === 'quick') args = ['tunnel', '--no-autoupdate', '--url', origin]
      else {
        // The token goes through the environment, never the command line where other users can read it.
        env.TUNNEL_TOKEN = (await this.options.token()) ?? ''
        args = ['tunnel', '--no-autoupdate', 'run']
      }
      const child = (this.options.spawnProcess ?? spawn)(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      let log = ''
      const read = (chunk: Buffer) => {
        if (generation !== this.generation) return
        log = (log + chunk.toString()).slice(-8192)
        if (this.state === 'running') return
        if (this.setting.mode === 'quick') {
          const url = quickTunnelUrl(log)
          if (url) this.running(url)
        } else if (/Registered tunnel connection/i.test(log)) this.running(`https://${this.setting.hostname}`)
      }
      child.stdout?.on('data', read)
      child.stderr?.on('data', read)
      child.once('error', (error) => this.exited(generation, error.message))
      child.once('exit', (code) =>
        this.exited(generation, lastError(log) ?? `cloudflared stopped${code === null ? '' : ` (exit ${code})`}`),
      )
    } catch (error) {
      if (generation !== this.generation) return
      this.options.unlisten()
      this.set('error', error instanceof Error ? error.message : String(error))
    }
  }

  private running(url: string) {
    this.attempts = 0
    this.url = url
    this.set('running')
  }

  private exited(generation: number, message: string) {
    if (generation !== this.generation) return
    this.child = null
    this.url = null
    this.set('error', message)
    // A dropped connection or a sleeping laptop is the usual cause; try again without the person's help.
    const delay = Math.min(60_000, 2000 * 2 ** this.attempts++)
    this.retry = setTimeout(() => {
      if (generation === this.generation) void this.start(generation)
    }, delay)
    this.retry.unref()
  }

  stop() {
    this.generation++
    clearTimeout(this.retry)
    this.attempts = 0
    const child = this.child
    this.child = null
    child?.kill()
    this.url = null
    this.options.unlisten()
    if (this.state !== 'off') this.set('off')
  }
}

const lastError = (log: string) =>
  log
    .split('\n')
    .reverse()
    .find((line) => / ERR /.test(line))
    ?.replace(/^.* ERR /, '')
    .trim()
    .slice(0, 300) ?? null

/** An installed cloudflared on PATH or in Homebrew's prefix, otherwise the pinned release in `binDir`. */
export async function resolveCloudflared(binDir: string): Promise<string> {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const candidates = [
    ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').map((dir) => join(dir, exe)),
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
  ]
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  const target = join(binDir, `cloudflared-${CLOUDFLARED_VERSION}${process.platform === 'win32' ? '.exe' : ''}`)
  if (existsSync(target)) return target
  const release = RELEASES[`${process.platform}-${process.arch}`]
  if (!release) throw new Error('Install cloudflared for this computer, then try again')
  mkdirSync(binDir, { recursive: true, mode: 0o700 })
  const response = await fetch(
    `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${release.file}`,
    { signal: AbortSignal.timeout(120_000) },
  )
  if (!response.ok) throw new Error(`Could not download cloudflared (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256)
    throw new Error('The downloaded cloudflared did not match its published checksum')
  const partial = `${target}.partial`
  if (release.archive) {
    const archive = join(binDir, release.file)
    writeFileSync(archive, bytes, { mode: 0o600 })
    try {
      await run('tar', ['-xzf', archive, '-C', binDir, 'cloudflared'])
      renameSync(join(binDir, 'cloudflared'), partial)
    } finally {
      rmSync(archive, { force: true })
    }
  } else writeFileSync(partial, bytes, { mode: 0o700 })
  chmodSync(partial, 0o700)
  renameSync(partial, target)
  return target
}

const run = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed`))))
  })
