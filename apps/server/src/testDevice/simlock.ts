// Simlock, the device daemon under Ramu's test devices, and agent-device, which it supervises: installed pinned into
// Ramu's tools folder, run with Ramu's own Node, and configured for what Ramu relies on. Agents never see either.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ocuToolsDir } from '../computer/ocu'
import { findExecutable } from '../providers/providerBinaries'

/** The releases Ramu installs and was checked against; the pin moves only after the plan's checks pass again. */
export const SIMLOCK_VERSION = '0.6.0'
export const AGENT_DEVICE_VERSION = '0.21.36'

/** Simlock 0.6.0's own cap on devices running at once, put back when the person leaves it to the host's memory. */
export const SIMLOCK_DEFAULT_MAX_RUNNING = 7

/** Simlock's settings for the person's choices on the Test devices page. */
export function chosenConfig(choice: { keepWarm: boolean; maxRunning: number | null; slim: boolean }) {
  return {
    'warmPool.enabled': String(choice.keepWarm),
    'capacity.config.limits.maxRunning': String(choice.maxRunning ?? SIMLOCK_DEFAULT_MAX_RUNNING),
    'ios.defaultMode': choice.slim ? 'slim' : 'full',
  }
}

/** Settings Ramu writes into Simlock's configuration, measured to give a sharp, smooth picture. */
export const SIMLOCK_CONFIG: Record<string, string> = {
  'http.host': '127.0.0.1',
  'http.port': '4795',
  'capabilities.stream.enabled': 'true',
  'capabilities.stream.maxDimension': '1600',
  'capabilities.stream.fps': '60',
  'capabilities.stream.bitrateKbps': '4000',
  'capabilities.input.enabled': 'true',
  'capabilities.agent-device.enabled': 'true',
}

export const simlockToolDir = () => join(ocuToolsDir(), `simlock-${SIMLOCK_VERSION}`)
/** Kept short: the daemon's socket path must fit macOS's 103-byte limit. */
export const simlockHome = () => process.env.RAMU_SIMLOCK_HOME ?? join(homedir(), '.ramu/simlock')
/** agent-device's own state, apart from any copy the person runs themselves in ~/.agent-device. */
export const agentDeviceHome = () => join(simlockHome(), 'agent-device')
const shimDir = () => join(simlockToolDir(), 'bin')
const cliMain = () => join(simlockToolDir(), 'node_modules/simlock/dist/cli/main.js')
export const agentDeviceExecutable = () => join(simlockToolDir(), 'node_modules/.bin/agent-device')

/** Android's SDK tools need Java; Android Studio carries one when the person has none installed. */
function javaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME
  for (const candidate of [
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    join(homedir(), 'Applications/Android Studio.app/Contents/jbr/Contents/Home'),
    '/opt/android-studio/jbr',
    join(homedir(), 'android-studio/jbr'),
  ])
    if (existsSync(candidate)) return candidate
  return undefined
}

/** The environment Simlock and agent-device run in: Ramu's Node first on PATH, and their homes under Ramu's folder. */
export function simlockEnvironment(): NodeJS.ProcessEnv {
  const java = javaHome()
  return {
    ...process.env,
    PATH: `${shimDir()}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    SIMLOCK_HOME: simlockHome(),
    AGENT_DEVICE_HOME: agentDeviceHome(),
    ...(java ? { JAVA_HOME: java } : {}),
  }
}

export const simlockInstalled = () => existsSync(cliMain()) && existsSync(agentDeviceExecutable())

export type Exec = (file: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string>
const execute: Exec = (file, args, env) =>
  new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      { timeout: 600_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env },
      (error, stdout, stderr) =>
        error ? reject(new SimlockCliError(stderr.trim() || error.message, stdout)) : resolve(stdout),
    ),
  )

/** A Simlock command that failed, with its JSON error when it printed one. */
export class SimlockCliError extends Error {
  readonly code: string | null
  constructor(
    text: string,
    /** What the command printed before it failed; `doctor` reports its findings this way. */
    readonly stdout = '',
  ) {
    const parsed = parseError(stdout) ?? parseError(text)
    super(parsed?.message ?? text)
    this.code = parsed?.code ?? null
  }
}

function parseError(text: string): { code: string; message: string } | null {
  for (const line of text.split('\n').reverse()) {
    try {
      const value = JSON.parse(line) as { error?: { code?: string; message?: string } }
      if (value.error?.message) return { code: value.error.code ?? 'UNKNOWN', message: value.error.message }
    } catch {
      // Not every line is JSON.
    }
  }
  return null
}

/** Runs the pinned Simlock CLI with Ramu's Node; output is its JSON or text, as the command prints it. */
export function simlock(args: string[], exec: Exec = execute): Promise<string> {
  return exec(join(shimDir(), 'node'), [cliMain(), ...args], simlockEnvironment())
}

/** A Simlock passthrough command whose output is bytes, such as an Android screenshot. */
export function simlockBytes(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile(
      join(shimDir(), 'node'),
      [cliMain(), ...args],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000, env: simlockEnvironment() },
      (error, stdout, stderr) =>
        error ? reject(new SimlockCliError(stderr.toString().trim() || error.message)) : resolve(stdout),
    ),
  )
}

/** The last JSON line a Simlock command printed. */
export function lastJson<T>(stdout: string): T {
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((entry) => entry.trim().startsWith('{') || entry.trim().startsWith('['))
  if (!line) throw new Error('Simlock gave no answer.')
  return JSON.parse(line) as T
}

/**
 * Installs the pinned Simlock and agent-device under Ramu's tools folder with npm, and a `node` that is Ramu's own, so
 * their scripts and the daemon run on the Node Ramu ships rather than whatever is on PATH.
 */
export async function installSimlock(exec: Exec = execute, npm: string | null = findExecutable('npm')): Promise<void> {
  if (!npm) throw new Error('Install Node.js (npm) first, then try again.')
  const dir = simlockToolDir()
  await mkdir(join(dir, 'bin'), { recursive: true })
  await exec(npm, [
    'install',
    '--prefix',
    dir,
    '--no-audit',
    '--no-fund',
    `simlock@${SIMLOCK_VERSION}`,
    `agent-device@${AGENT_DEVICE_VERSION}`,
  ])
  const shim = join(dir, 'bin/node')
  // Inside the desktop app Ramu's executable is Electron, which runs as plain Node with this variable.
  await writeFile(shim, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`)
  await chmod(shim, 0o755)
  const version = (await simlock(['--version'], exec)).trim()
  if (!version.includes(SIMLOCK_VERSION)) throw new Error(`Installed Simlock ${version}, expected ${SIMLOCK_VERSION}.`)
}

/** One `simlock doctor` finding, as the setup checklist shows it. */
export interface DoctorFinding {
  platform: 'ios' | 'android' | null
  item: string
  message: string
  remedy: string | null
}

export function parseDoctor(stdout: string): DoctorFinding[] {
  const report = lastJson<{
    findings?: { platform?: string; prerequisite?: string; kind?: string; message?: string; remedy?: string }[]
  }>(stdout)
  return (report.findings ?? []).map((finding) => ({
    platform: finding.platform === 'ios' || finding.platform === 'android' ? finding.platform : null,
    item: finding.prerequisite ?? finding.kind ?? 'setup',
    message: finding.message ?? '',
    remedy: finding.remedy ?? null,
  }))
}

/** The daemon's loopback address, from the port Ramu configured. */
export const simlockUrl = () => `http://127.0.0.1:${SIMLOCK_CONFIG['http.port']}`

/** A token Ramu made, for the label it is found and revoked by on the next start. */
export const RAMU_TOKEN_LABEL = 'ramu'

interface TokenRecord {
  id: string
  role: string
  label?: string
}

/**
 * The daemon on this host as Ramu uses it: installed, configured with Ramu's settings, running, and reached over
 * loopback with an operator token made at each start and held only in memory, so no Simlock secret is ever stored.
 */
export class SimlockHost {
  private operator: string | null = null
  private preparing: Promise<void> | null = null

  constructor(
    /** Settings the person chose, written over Ramu's own, such as keeping a spare device ready. */
    private readonly chosen: () => Record<string, string> = () => ({}),
    private readonly exec: Exec = execute,
    private readonly http: typeof fetch = fetch,
  ) {}

  /** Applies a changed choice: the daemon restarts with it, and leases survive the restart. */
  reconfigure(): Promise<void> {
    this.preparing = null
    return this.ready()
  }

  /** Configures and starts the daemon once per server start; later calls wait for the same work. */
  ready(): Promise<void> {
    if (!simlockInstalled()) return Promise.reject(new Error('Set up test devices first.'))
    this.preparing ??= this.prepare().catch((error: unknown) => {
      this.preparing = null
      throw error
    })
    return this.preparing
  }

  private async prepare() {
    const wanted = {
      ...SIMLOCK_CONFIG,
      ...this.chosen(),
      'capabilities.agent-device.command': agentDeviceExecutable(),
    }
    let changed = false
    for (const [key, value] of Object.entries(wanted)) {
      const current = (await simlock(['config', 'get', key], this.exec).catch(() => '')).trim()
      if (current === value) continue
      await simlock(['config', 'set', key, value], this.exec)
      changed = true
    }
    const running = await simlock(['daemon', 'status'], this.exec).then(
      (text) => /running/i.test(text),
      () => false,
    )
    if (running && changed) await simlock(['daemon', 'stop'], this.exec)
    if (!running || changed) await simlock(['daemon', 'start'], this.exec)
    // Tokens from an earlier start are useless now that their secrets are gone, so they are revoked.
    const { tokens } = lastJson<{ tokens: TokenRecord[] }>(await simlock(['token', 'list'], this.exec))
    const stale = tokens.filter((entry) => entry.label?.startsWith(RAMU_TOKEN_LABEL)).map((entry) => entry.id)
    for (const id of stale) await simlock(['token', 'revoke', id], this.exec).catch(() => {})
    this.operator = (await this.createToken('operator', RAMU_TOKEN_LABEL)).secret
    // A device an earlier run held stays leased after Ramu stops: Simlock's own agent-device keeps renewing it. Its
    // thread is gone with that run, so the device goes back now instead of staying booted.
    const response = await this.http(`${simlockUrl()}/v1/leases`, {
      headers: { authorization: `Bearer ${this.operator}` },
    })
    const leases = response.ok ? ((await response.json()) as { leases: SimlockLease[] }).leases : []
    for (const lease of leases.filter((entry) => entry.ownerId && stale.includes(entry.ownerId)))
      await simlock(['release', lease.id], this.exec).catch(() => {})
  }

  /** A token for one thread's agent-device session, so each thread is its own requester with its own lease. */
  async createToken(role: 'agent' | 'operator', label: string): Promise<{ id: string; secret: string }> {
    const created = lastJson<{ secret: string; token: { id: string } }>(
      await simlock(['token', 'create', '--role', role, '--label', label], this.exec),
    )
    return { id: created.token.id, secret: created.secret }
  }

  revokeToken(id: string): Promise<void> {
    return simlock(['token', 'revoke', id], this.exec).then(
      () => {},
      () => {},
    )
  }

  /** Simlock's findings for what this host still needs, per platform, with each fix. */
  async doctor(): Promise<DoctorFinding[]> {
    const stdout = await simlock(['doctor'], this.exec).catch((error: unknown) =>
      error instanceof SimlockCliError && error.stdout ? error.stdout : Promise.reject(error),
    )
    return parseDoctor(stdout)
  }

  /** Leases, waiting requests and capacity, as the daemon reports them. */
  async status(): Promise<SimlockStatus> {
    await this.ready()
    return lastJson<SimlockStatus>(await simlock(['status', '--json'], this.exec))
  }

  /** Models and runtimes that can be leased, with which pair together. */
  async catalog(): Promise<SimlockCatalog> {
    await this.ready()
    return lastJson<SimlockCatalog>(await simlock(['catalog', '--json'], this.exec))
  }

  /**
   * A loopback request as the operator, or as `holder` (a thread's own token) for what only a lease's holder may do,
   * such as turning its device. Tokens never leave this process.
   */
  async request(path: string, init: RequestInit = {}, holder?: string): Promise<Response> {
    await this.ready()
    return this.http(`${simlockUrl()}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${holder ?? this.operator}` },
    })
  }
}

export interface SimlockLease {
  id: string
  deviceId: string
  requesterId: string
  ownerId?: string
  grantedAt: number
  ttlMs: number
  ttlDeadline?: number
}

export interface SimlockDevice {
  id: string
  driverDeviceId: string
  address?: string
  state: string
  spec: { platform: 'ios' | 'android'; model: string; osVersion: string; physical: boolean }
}

export interface SimlockStatus {
  devices: SimlockDevice[]
  leases: SimlockLease[]
  /** Requests not yet holding a device, as Simlock 0.6.0 reports them: `queuePosition` once `stage` is `queued`. */
  waiting: {
    requesterId?: string
    spec?: { platform?: string }
    createdAt?: number
    stage?: string
    queuePosition?: number
    reason?: string
  }[]
  capacity: Record<'ios' | 'android', { running: number; maxRunning: number; limit: number }>
}

export interface SimlockCatalog {
  platforms?: {
    platform: 'ios' | 'android'
    models: string[]
    runtimes: string[]
    defaultRuntime?: string
    /** The installed runtimes each model pairs with; an empty list means it cannot be leased here now. */
    modelRuntimes?: Record<string, string[]>
    modelClasses?: Record<string, string>
    classDefaults?: Record<string, string>
  }[]
}
