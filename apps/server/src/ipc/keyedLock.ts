/** Serializes mutating Git operations per checkout directory. */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>()
  runMany<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort()
    const acquire = (index: number): Promise<T> =>
      index === ordered.length ? fn() : this.run(ordered[index]!, () => acquire(index + 1))
    return acquire(0)
  }
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.tails.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }
}
