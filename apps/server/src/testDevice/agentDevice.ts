// One thread's agent-device session against this host's Simlock: the session takes the thread's own lease through
// Simlock's agent-device front, and every agent action on the device goes through it. Commands are fixed programs with
// checked arguments; nothing reaches a shell.
import { execFile } from 'node:child_process'
import { agentDeviceExecutable, agentDeviceHome, simlockEnvironment, simlockUrl } from './simlock'

export type AgentDeviceRun = (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<string>

const runAgentDevice: AgentDeviceRun = (args, env, timeoutMs) =>
  new Promise((resolve, reject) =>
    execFile(
      agentDeviceExecutable(),
      args,
      { env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) =>
        error ? reject(new AgentDeviceError(stdout, stderr || error.message)) : resolve(stdout),
    ),
  )

/** A cold boot and the first runner build take minutes; waiting in Simlock's queue can take longer still. */
const OPEN_TIMEOUT_MS = 30 * 60_000

/** A command agent-device refused, with its own message and code when it printed them. */
export class AgentDeviceError extends Error {
  readonly code: string | null
  constructor(stdout: string, fallback: string) {
    let message = fallback.trim()
    let code: string | null = null
    try {
      const parsed = JSON.parse(stdout) as { error?: { message?: string; code?: string } }
      if (parsed.error?.message) message = parsed.error.message
      code = parsed.error?.code ?? null
    } catch {
      // Not JSON; the process's own words stand.
    }
    super(message || 'The test device did not answer.')
    this.code = code
  }
}

/** One element agent-device found on screen, in the device's own points (Android: pixels). */
export interface DeviceElement {
  ref: string
  kind: string
  label: string | null
  value: string | null
  identifier: string | null
  rect: { x: number; y: number; width: number; height: number }
  hittable: boolean
  editable: boolean
  depth: number
}

interface RawNode {
  ref?: string
  kind?: string
  type?: string
  label?: string
  value?: string
  identifier?: string
  rect?: { x: number; y: number; width: number; height: number }
  hittable?: boolean
  editable?: boolean
  depth?: number
}

export function parseSnapshot(stdout: string): DeviceElement[] {
  const data = (JSON.parse(stdout) as { data?: { nodes?: RawNode[] } }).data
  return (data?.nodes ?? [])
    .filter((node): node is RawNode & { ref: string; rect: NonNullable<RawNode['rect']> } => !!node.ref && !!node.rect)
    .map((node) => ({
      ref: node.ref,
      kind: node.kind ?? node.type ?? 'element',
      label: node.label?.trim() || null,
      value: node.value?.trim() || null,
      identifier: node.identifier?.trim() || null,
      rect: node.rect,
      hittable: node.hittable !== false,
      editable: node.editable === true,
      depth: node.depth ?? 0,
    }))
}

/**
 * The elements as short lines an agent reads beside the screenshot: ref, kind, what it says and its centre in the
 * screenshot's pixels, so it can tap by ref or by point. Elements that say nothing and cannot be tapped are left out.
 */
export function elementsText(elements: DeviceElement[], scale: number, limit = 12_000): string {
  const lines: string[] = []
  for (const element of elements) {
    const words = element.label ?? element.value ?? element.identifier
    if (!words && !element.hittable) continue
    const x = Math.round((element.rect.x + element.rect.width / 2) * scale)
    const y = Math.round((element.rect.y + element.rect.height / 2) * scale)
    const value = element.value && element.value !== words ? ` = "${element.value}"` : ''
    lines.push(
      `${'  '.repeat(Math.min(element.depth, 6))}@${element.ref} ${element.kind}${words ? ` "${words}"` : ''}${value}${element.editable ? ' (editable)' : ''} @${x},${y}`,
    )
  }
  const text = lines.join('\n')
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text
}

/** A thread's session: its name, token and the commands Ramu sends through it. */
export class AgentDeviceSession {
  constructor(
    /** Unique per thread, so one thread never reaches another's device. */
    readonly name: string,
    private readonly token: string,
    private readonly run: AgentDeviceRun = runAgentDevice,
  ) {}

  private env(): NodeJS.ProcessEnv {
    return { ...simlockEnvironment(), AGENT_DEVICE_DAEMON_AUTH_TOKEN: this.token }
  }

  /** Runs one command for this session and returns its JSON `data`. */
  async command<T = Record<string, unknown>>(args: string[], timeoutMs = 120_000): Promise<T> {
    const stdout = await this.run(
      [...args, '--session', this.name, '--state-dir', agentDeviceHome(), '--json'],
      this.env(),
      timeoutMs,
    )
    return ((JSON.parse(stdout) as { data?: T }).data ?? {}) as T
  }

  /** Points the session at this host's Simlock; no device is taken yet. */
  connect(): Promise<unknown> {
    return this.command(['connect', 'proxy', '--daemon-base-url', `${simlockUrl()}/v1/agent-device`, '--force'])
  }

  /**
   * Takes a device through Simlock and opens the home screen or an app on it. Waits in Simlock's queue when the host is
   * full; the caller reads the queue position meanwhile.
   */
  open(input: { platform: 'ios' | 'android'; model?: string; os?: string; app?: string }) {
    return this.command<{
      device_udid?: string
      serial?: string
      id?: string
      lease?: { device?: { model?: string; osVersion?: string } }
    }>(
      [
        'open',
        ...(input.app ? [input.app] : []),
        '--platform',
        input.platform,
        ...(input.model ? ['--device', input.model] : []),
        ...(input.os ? ['--os', input.os] : []),
        ...(input.app ? ['--relaunch'] : []),
        // agent-device's own request limit is shorter than a cold emulator boot.
        '--timeout',
        String(OPEN_TIMEOUT_MS),
      ],
      OPEN_TIMEOUT_MS + 60_000,
    )
  }

  async snapshot(): Promise<DeviceElement[]> {
    const stdout = await this.run(
      ['snapshot', '-i', '--session', this.name, '--state-dir', agentDeviceHome(), '--json'],
      this.env(),
      180_000,
    )
    return parseSnapshot(stdout)
  }

  press(target: { ref: string } | { x: number; y: number }) {
    return this.command('ref' in target ? ['press', `@${target.ref}`] : ['press', String(target.x), String(target.y)])
  }

  type(text: string) {
    return this.command(['type', text])
  }

  swipe(from: { x: number; y: number }, to: { x: number; y: number }) {
    return this.command(['swipe', String(from.x), String(from.y), String(to.x), String(to.y)])
  }

  back() {
    return this.command(['back'])
  }

  home() {
    return this.command(['home'])
  }

  /** Ends the session and gives the device back; Simlock deletes it afterwards. */
  close() {
    return this.command(['close'], 60_000).then(
      () => {},
      () => {},
    )
  }
}
