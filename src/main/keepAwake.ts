import { spawn, type ChildProcess } from 'node:child_process'

/** A daemon-owned idle-sleep assertion survives closing the Electron window.
 * caffeinate -w also releases it if the daemon crashes or is killed. */
export class KeepAwakeService {
  private child?: ChildProcess
  private error: string | null = null
  readonly supported = process.platform === 'darwin'
  constructor(private enabled: () => boolean) { this.settingsChanged() }
  settingsChanged() {
    if (!this.enabled() || !this.supported) { this.close(); return }
    if (this.child) return
    this.error = null
    const child = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
    this.child = child
    child.once('error', () => { if (this.child === child) { this.child = undefined; this.error = 'Could not keep the computer awake.' } })
    child.once('exit', (code) => { if (this.child === child) { this.child = undefined; if (code) this.error = 'The keep-awake assertion stopped.' } })
  }
  status() { return { enabled: this.enabled(), active: !!this.child && !this.child.killed, supported: this.supported, error: this.error, pid: this.child?.pid ?? null } }
  close() { const child = this.child; this.child = undefined; child?.kill('SIGTERM') }
}
