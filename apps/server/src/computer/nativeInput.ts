import type { ChildProcess } from 'node:child_process'

/**
 * A line-per-command helper process: each command waits for its own `ok` or `err <reason>` reply, in order. Commands
 * sent without a reply (pointer moves) never block the ones that wait. When the process ends, everything waiting fails
 * and the next command starts a new one.
 */
export class NativeInput {
  private child: Promise<ChildProcess | null> | null = null
  private waiting: { resolve(): void; reject(error: Error): void }[] = []
  constructor(private readonly start: () => Promise<ChildProcess | null>) {}

  private process(): Promise<ChildProcess | null> {
    this.child ??= this.start().then(
      (child) => {
        if (!child) return null
        let buffered = ''
        child.stdout?.on('data', (chunk: Buffer) => {
          buffered += chunk.toString()
          for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
            const line = buffered.slice(0, end).trim()
            buffered = buffered.slice(end + 1)
            const waiter = this.waiting.shift()
            if (!waiter) continue
            if (line === 'ok') waiter.resolve()
            else waiter.reject(new Error(line.replace(/^err\s*/, '') || 'The input did not run.'))
          }
        })
        const gone = () => this.end(new Error('The input helper stopped.'))
        child.once('exit', gone)
        child.once('error', gone)
        child.stdin?.on('error', gone)
        return child
      },
      () => {
        this.child = null
        return null
      },
    )
    return this.child
  }

  private end(error: Error) {
    this.child = null
    for (const waiter of this.waiting.splice(0)) waiter.reject(error)
  }

  /** False when no helper could be started, so the caller can fall back. */
  async available(): Promise<boolean> {
    return !!(await this.process())?.stdin?.writable
  }

  /** Sends one command and waits for its reply, or only sends it when `reply` is false. */
  async send(line: string, reply = true): Promise<void> {
    const child = await this.process()
    if (!child?.stdin?.writable) throw new Error('The input helper is not running.')
    if (!reply) {
      child.stdin.write(`${line}\n`)
      return
    }
    await new Promise<void>((resolve, reject) => {
      this.waiting.push({ resolve, reject })
      child.stdin!.write(`${line}\n`)
    })
  }

  close() {
    void this.child?.then((child) => child?.kill())
    this.child = null
  }
}
