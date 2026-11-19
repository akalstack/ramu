/**
 * A provider may send a tool call again after a dropped connection. A call that carries a request id gets the first
 * call's result back instead of starting the same work twice. A start that failed is forgotten, so it can be retried.
 */
export class RequestReplay<T> {
  private readonly entries = new Map<string, { at: number; result: Promise<T> }>()

  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly limit = 500,
    private readonly now: () => number = Date.now,
  ) {}

  run(key: string, start: () => Promise<T>): Promise<T> {
    this.prune()
    const known = this.entries.get(key)
    if (known) return known.result
    const result = start()
    this.entries.set(key, { at: this.now(), result })
    result.catch(() => {
      if (this.entries.get(key)?.result === result) this.entries.delete(key)
    })
    return result
  }

  private prune() {
    const cutoff = this.now() - this.ttlMs
    for (const [key, entry] of this.entries) if (entry.at < cutoff) this.entries.delete(key)
    while (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!)
  }
}
