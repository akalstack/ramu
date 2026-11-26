/**
 * Notes each pause of this process long enough for a connected window to notice, with the calls that were running, so
 * a window that showed "Reconnecting…" can be traced to what held the service.
 */
export function watchStalls(
  running: () => string[],
  log: (message: string) => void,
  {
    now = Date.now,
    everyMs = 1000,
    thresholdMs = 5000,
  }: { now?: () => number; everyMs?: number; thresholdMs?: number } = {},
) {
  let last = now()
  const timer = setInterval(() => {
    const at = now()
    const paused = at - last - everyMs
    last = at
    if (paused < thresholdMs) return
    const calls = running()
    log(
      `The service paused for ${(paused / 1000).toFixed(1)} s. Calls running: ${calls.length ? calls.join(', ') : 'none'}.`,
    )
  }, everyMs)
  timer.unref()
  return () => clearInterval(timer)
}

/** Calls in progress, oldest first, by method and how long each has run. */
export class RunningCalls {
  private readonly calls = new Map<number, { method: string; at: number }>()
  private next = 0

  constructor(private readonly now: () => number = Date.now) {}

  start(method: string): () => void {
    const id = this.next++
    this.calls.set(id, { method: method.slice(0, 100), at: this.now() })
    return () => this.calls.delete(id)
  }

  list(limit = 10): string[] {
    const at = this.now()
    return [...this.calls.values()]
      .slice(0, limit)
      .map((call) => `${call.method} (${((at - call.at) / 1000).toFixed(1)} s)`)
  }
}
