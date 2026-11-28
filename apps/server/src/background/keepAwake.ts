import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SYSTEMD_INHIBIT = ['/usr/bin/systemd-inhibit', '/bin/systemd-inhibit'].find((path) => existsSync(path))
const POWER_SUPPLY = '/sys/class/power_supply'
// Linux has no "only on AC" sleep lock, so Plugged in only re-reads the power source this often.
const POWER_POLL_MS = 60_000
// On battery, Plugged in only still keeps the host awake while agents work, read this often.
const WORK_POLL_MS = 15_000
/** How long the lock outlives the last running agent, so a machine does not sleep between back-to-back runs. */
export const WORK_GRACE_MS = 60_000

/**
 * Whether a Linux host runs on mains power. A machine with no battery always does; a laptop does while any mains
 * supply reports online.
 */
export function onMainsPower(root = POWER_SUPPLY): boolean {
  let supplies: string[]
  try {
    supplies = readdirSync(root)
  } catch {
    return true
  }
  const read = (supply: string, file: string) => {
    try {
      return readFileSync(join(root, supply, file), 'utf8').trim()
    } catch {
      return ''
    }
  }
  const types = supplies.map((supply) => ({ supply, type: read(supply, 'type') }))
  if (!types.some(({ type }) => type === 'Battery')) return true
  return types.some(({ supply, type }) => type === 'Mains' && read(supply, 'online') === '1')
}

/**
 * A daemon-owned idle-sleep lock that survives closing the Electron window. On macOS `caffeinate -w`, on Linux a
 * systemd-inhibit lock held by `tail --pid`; both end on their own if the daemon crashes or is killed.
 */
export class KeepAwakeService {
  private child?: ChildProcess
  private error: string | null = null
  private mode: 'plugged-in' | 'always' = 'plugged-in'
  private poll?: NodeJS.Timeout
  /**
   * logind lets only processes inside a login session block sleep, so a service started at login by systemd is refused.
   * It then holds an idle lock, which any process may take and which stops idle suspend on desktops that honour it.
   */
  private linuxLock: 'sleep' | 'idle' = 'sleep'
  /**
   * Plugged in only, on battery: the host stays awake while agents work, as T3 Code does, and for a minute after, so
   * a run that a laptop's owner left going is not cut off by idle sleep. On macOS a second assertion, `caffeinate -i`.
   */
  private workChild?: ChildProcess
  private working = false
  private lastWork = 0
  private workPoll?: NodeJS.Timeout
  readonly supported: boolean
  constructor(
    private enabled: () => boolean,
    private when: () => 'plugged-in' | 'always' = () => 'plugged-in',
    private platform: NodeJS.Platform = process.platform,
    private mains: () => boolean = onMainsPower,
    private busy: () => boolean = () => false,
    private now: () => number = Date.now,
  ) {
    this.supported = platform === 'darwin' || (platform === 'linux' && !!SYSTEMD_INHIBIT)
    this.settingsChanged()
  }
  /** Re-reads whether agents work and holds or lets go of the work lock, keeping it a grace period past the last. */
  checkWork() {
    if (this.busy()) this.lastWork = this.now()
    const working = this.lastWork > 0 && this.now() - this.lastWork < WORK_GRACE_MS
    if (working === this.working) return
    this.working = working
    if (this.platform === 'linux') this.syncLinux()
    else this.syncWorkLock()
  }
  private syncWorkLock() {
    const wanted = this.working && this.mode === 'plugged-in' && this.enabled() && this.supported
    if (wanted && !this.workChild) {
      const child = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
      this.workChild = child
      child.once('error', () => {
        if (this.workChild === child) this.workChild = undefined
      })
      child.once('exit', () => {
        if (this.workChild === child) this.workChild = undefined
      })
    } else if (!wanted && this.workChild) {
      const child = this.workChild
      this.workChild = undefined
      try {
        child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
    }
  }
  settingsChanged() {
    if (!this.enabled() || !this.supported) {
      this.close()
      return
    }
    if (!this.workPoll) {
      this.workPoll = setInterval(() => this.checkWork(), WORK_POLL_MS)
      this.workPoll.unref()
    }
    if (this.platform === 'linux') {
      this.mode = this.when()
      this.syncLinux()
      if (!this.poll && this.mode === 'plugged-in') {
        this.poll = setInterval(() => this.syncLinux(), POWER_POLL_MS)
        this.poll.unref()
      } else if (this.poll && this.mode === 'always') this.stopPolling()
      return
    }
    if (this.child && this.mode === this.when()) return
    this.release()
    this.mode = this.when()
    // -s is honored only on AC power; -i prevents idle sleep on either source.
    this.hold('/usr/bin/caffeinate', [this.mode === 'plugged-in' ? '-s' : '-i', '-w', String(process.pid)])
    this.syncWorkLock()
  }
  /** Holds the Linux lock while the chosen power policy allows it and lets go on battery under Plugged in only. */
  private syncLinux() {
    const wanted = this.mode === 'always' || this.mains() || this.working
    if (wanted && !this.child)
      this.hold(SYSTEMD_INHIBIT!, [
        `--what=${this.linuxLock}`,
        '--who=Ramu',
        '--why=Agents are working on this host',
        '--mode=block',
        'tail',
        `--pid=${process.pid}`,
        '-f',
        '/dev/null',
      ])
    else if (!wanted && this.child) this.release()
  }
  private hold(command: string, args: string[]) {
    this.error = null
    // Its own process group, so releasing it also ends the waiter systemd-inhibit runs.
    const child = spawn(command, args, { stdio: 'ignore', detached: this.platform === 'linux' })
    this.child = child
    child.once('error', () => {
      if (this.child === child) {
        this.child = undefined
        this.error = 'Could not keep the host awake.'
      }
    })
    child.once('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      if (code && this.platform === 'linux' && this.linuxLock === 'sleep') {
        this.linuxLock = 'idle'
        this.syncLinux()
      } else if (code) this.error = 'The keep-awake assertion stopped.'
    })
  }
  private release() {
    const child = this.child
    this.child = undefined
    if (!child?.pid) return
    try {
      if (this.platform === 'linux') process.kill(-child.pid, 'SIGTERM')
      else child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
  private stopPolling() {
    clearInterval(this.poll)
    this.poll = undefined
  }
  status() {
    return {
      enabled: this.enabled(),
      active: (!!this.child && !this.child.killed) || !!this.workChild,
      supported: this.supported,
      error: this.error,
      when: this.when(),
      pid: this.child?.pid ?? null,
    }
  }
  close() {
    this.stopPolling()
    clearInterval(this.workPoll)
    this.workPoll = undefined
    this.release()
    this.working = false
    this.syncWorkLock()
  }
}
