import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SYSTEMD_INHIBIT = ['/usr/bin/systemd-inhibit', '/bin/systemd-inhibit'].find((path) => existsSync(path))
const POWER_SUPPLY = '/sys/class/power_supply'
// Linux has no "only on AC" sleep lock, so Plugged in only re-reads the power source this often.
const POWER_POLL_MS = 60_000

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
  readonly supported: boolean
  constructor(
    private enabled: () => boolean,
    private when: () => 'plugged-in' | 'always' = () => 'plugged-in',
    private platform: NodeJS.Platform = process.platform,
    private mains: () => boolean = onMainsPower,
  ) {
    this.supported = platform === 'darwin' || (platform === 'linux' && !!SYSTEMD_INHIBIT)
    this.settingsChanged()
  }
  settingsChanged() {
    if (!this.enabled() || !this.supported) {
      this.close()
      return
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
  }
  /** Holds the Linux lock while the chosen power policy allows it and lets go on battery under Plugged in only. */
  private syncLinux() {
    const wanted = this.mode === 'always' || this.mains()
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
      active: !!this.child && !this.child.killed,
      supported: this.supported,
      error: this.error,
      when: this.when(),
      pid: this.child?.pid ?? null,
    }
  }
  close() {
    this.stopPolling()
    this.release()
  }
}
