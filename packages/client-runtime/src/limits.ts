// Bounds work that is starting, not long-lived connected streams. Queued work can be cancelled before it runs.
interface Job {
  key: string
  start: (release: () => void) => void
  queued: boolean
}
export class WorkLimiter {
  private readonly pending: Job[] = []
  private readonly activeKeys = new Map<string, number>()
  private active = 0
  constructor(
    private readonly limit: number,
    private readonly perKey: number,
    private readonly maxPending = 2048,
  ) {}

  schedule(key: string, start: (release: () => void) => void): () => void {
    if (this.pending.length >= this.maxPending) throw new Error('Too many pending remote requests')
    const job: Job = { key, start, queued: true }
    this.pending.push(job)
    this.pump()
    return () => {
      if (!job.queued) return
      const index = this.pending.indexOf(job)
      if (index >= 0) this.pending.splice(index, 1)
      job.queued = false
    }
  }

  acquire(key: string, signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Remote request cancelled'))
        return
      }
      let cancel = () => {}
      const aborted = () => {
        cancel()
        reject(new Error('Remote request cancelled'))
      }
      signal?.addEventListener('abort', aborted, { once: true })
      try {
        cancel = this.schedule(key, (release) => {
          signal?.removeEventListener('abort', aborted)
          resolve(release)
        })
      } catch (error) {
        signal?.removeEventListener('abort', aborted)
        reject(error)
      }
    })
  }

  private pump() {
    while (this.active < this.limit) {
      const index = this.pending.findIndex((job) => (this.activeKeys.get(job.key) ?? 0) < this.perKey)
      if (index < 0) return
      const job = this.pending.splice(index, 1)[0]!
      job.queued = false
      this.active++
      this.activeKeys.set(job.key, (this.activeKeys.get(job.key) ?? 0) + 1)
      let done = false
      const release = () => {
        if (done) return
        done = true
        this.active--
        const count = this.activeKeys.get(job.key)! - 1
        if (count) this.activeKeys.set(job.key, count)
        else this.activeKeys.delete(job.key)
        this.pump()
      }
      try {
        job.start(release)
      } catch {
        release()
      }
    }
  }
}
export const remoteRequests = new WorkLimiter(16, 4)
