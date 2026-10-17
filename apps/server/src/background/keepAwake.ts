import { spawn, type ChildProcess } from 'node:child_process'

/** A daemon-owned idle-sleep assertion survives closing the Electron window.
 * caffeinate -w also releases it if the daemon crashes or is killed. */
export class KeepAwakeService {
  private child?: ChildProcess
  private error: string | null = null
  private mode: 'plugged-in' | 'always' = 'plugged-in'
  readonly supported = process.platform === 'darwin'
  constructor(
    private enabled: () => boolean,
    private when: () => 'plugged-in' | 'always' = () => 'plugged-in',
  ) {
    this.settingsChanged()
  }
  settingsChanged() {
    if (!this.enabled() || !this.supported) {
      this.close()
      return
    }
    if (this.child && this.mode === this.when()) return
    this.close()
    this.mode = this.when()
    this.error = null
    // -s is honored only on AC power; -i prevents idle sleep on either source.
    const child = spawn('/usr/bin/caffeinate', [this.mode === 'plugged-in' ? '-s' : '-i', '-w', String(process.pid)], {
      stdio: 'ignore',
    })
    this.child = child
    child.once('error', () => {
      if (this.child === child) {
        this.child = undefined
        this.error = 'Could not keep the host awake.'
      }
    })
    child.once('exit', (code) => {
      if (this.child === child) {
        this.child = undefined
        if (code) this.error = 'The keep-awake assertion stopped.'
      }
    })
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
    const child = this.child
    this.child = undefined
    child?.kill('SIGTERM')
  }
}
