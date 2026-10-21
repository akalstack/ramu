import { spawn, type ChildProcess } from 'node:child_process'

type Spawn = (file: string, args: string[]) => ChildProcess

/**
 * Keeps this Mac from idle-sleeping while a thread has computer access. The screen may still turn off: this holds only the
 * system awake (`caffeinate -i`), and ends the moment the last grant is gone or this process exits.
 */
export class KeepAwake {
  private holders = new Set<string>()
  private child: ChildProcess | null = null
  constructor(
    private readonly start: Spawn = (file, args) => spawn(file, args, { stdio: 'ignore' }),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  get active(): boolean {
    return this.child !== null
  }

  acquire(key: string) {
    this.holders.add(key)
    if (this.platform !== 'darwin' || this.child) return
    // `-w` ends caffeinate with this process even if we never get to release.
    const child = this.start('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)])
    child.once('exit', () => {
      if (this.child === child) this.child = null
    })
    child.once('error', () => {
      if (this.child === child) this.child = null
    })
    this.child = child
  }

  release(key: string) {
    this.holders.delete(key)
    if (this.holders.size || !this.child) return
    const child = this.child
    this.child = null
    child.kill()
  }

  releaseAll() {
    this.holders.clear()
    this.child?.kill()
    this.child = null
  }
}
