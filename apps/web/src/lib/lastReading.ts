/**
 * The last reading of something a thread shows beside its composer (browser tabs, terminals, context), kept while the
 * app runs. Opening the thread again draws it at once, then corrects it, instead of growing in as each reading returns.
 */
const kept = new Map<string, unknown>()
const LIMIT = 400

export function lastReading<T>(kind: string, scope: string): T | undefined {
  return kept.get(`${kind}\n${scope}`) as T | undefined
}

export function keepReading<T>(kind: string, scope: string, value: T): void {
  const key = `${kind}\n${scope}`
  // Re-inserted so the map's order is by last use, and the oldest reading is the one dropped at the limit.
  kept.delete(key)
  kept.set(key, value)
  if (kept.size > LIMIT) kept.delete(kept.keys().next().value!)
}
