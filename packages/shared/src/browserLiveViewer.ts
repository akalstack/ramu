import type { BrowserHumanInput, BrowserLiveFrame, BrowserScreenshot } from './browserBridge'

/** One outstanding frame request: the host keeps the newest frame and slow connections skip older ones. */
export function watchBrowserFrames(options: {
  next(after: number): Promise<BrowserLiveFrame | null>
  fallback(): Promise<BrowserScreenshot>
  show(frame: BrowserScreenshot): void
  ready(value: boolean): void
  error(message: string): void
}) {
  let stopped = false
  let after = 0
  let fallback = false
  let hasFrame = false
  let watchdog: ReturnType<typeof setTimeout>
  let timer: ReturnType<typeof setTimeout>
  const run = async () => {
    const start = Date.now()
    let delay = fallback ? 750 : 33
    watchdog = setTimeout(() => {
      if (!stopped) {
        options.ready(false)
        options.error('The browser connection is slow. Waiting for a fresh frame…')
      }
    }, 5000)
    try {
      const frame = fallback ? await options.fallback() : await options.next(after)
      if (stopped) return
      if (frame) {
        if ('sequence' in frame && typeof frame.sequence === 'number') after = frame.sequence
        options.show(frame)
        hasFrame = true
      }
      options.ready(hasFrame)
      options.error('')
    } catch (error) {
      if (stopped) return
      const message = error instanceof Error ? error.message : String(error)
      // A runtime without a compositor feed keeps the screenshot viewer.
      if (
        /Live browser frames are unavailable|live browser frame is unavailable|startScreencast.*(wasn't found|not found|not supported)/i.test(
          message,
        )
      ) {
        fallback = true
        delay = 750
      } else {
        options.ready(false)
        options.error(message)
        delay = 750
      }
    } finally {
      clearTimeout(watchdog)
      if (!stopped) timer = setTimeout(() => void run(), Math.max(0, delay - (Date.now() - start)))
    }
  }
  void run()
  return () => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(watchdog)
  }
}

interface PendingInput {
  input: BrowserHumanInput
  resolve(): void
  reject(error: Error): void
}

/** Serialize human input without disabling gestures. Merge only adjacent wheel deltas, preserving click/key order. */
export class BrowserInputQueue {
  private readonly pending: PendingInput[] = []
  private sending = false
  private queued = 0
  private closed = false
  constructor(private readonly send: (input: BrowserHumanInput) => Promise<void>) {}

  push(input: BrowserHumanInput): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Browser control changed. Take control again to continue.'))
    if (this.queued >= 64) return Promise.reject(new Error('Wait for the browser to catch up.'))
    this.queued++
    return new Promise<void>((resolve, reject) => {
      const last = this.pending.at(-1)
      if (
        input.kind === 'scroll' &&
        last?.input.kind === 'scroll' &&
        Math.abs(input.x + last.input.x) <= 2000 &&
        Math.abs(input.y + last.input.y) <= 2000
      ) {
        last.input = { kind: 'scroll', x: last.input.x + input.x, y: last.input.y + input.y }
        const previousResolve = last.resolve,
          previousReject = last.reject
        last.resolve = () => {
          previousResolve()
          resolve()
        }
        last.reject = (error) => {
          previousReject(error)
          reject(error)
        }
      } else this.pending.push({ input, resolve, reject })
      void this.drain()
    }).finally(() => {
      this.queued--
    })
  }
  private async drain() {
    if (this.sending || this.closed) return
    this.sending = true
    try {
      while (!this.closed && this.pending.length) {
        const entry = this.pending.shift()!
        try {
          await this.send(entry.input)
          entry.resolve()
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          entry.reject(failure)
          // An uncertain input is never replayed; stop the sequence so a failed click cannot redirect later typing.
          this.close(failure)
        }
      }
    } finally {
      this.sending = false
    }
  }
  close(error = new Error('Browser control changed. Take control again to continue.')) {
    this.closed = true
    for (const entry of this.pending.splice(0)) entry.reject(error)
  }
}
