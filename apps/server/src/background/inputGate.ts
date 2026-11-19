import { createHash } from 'node:crypto'

/** The slice of Workspace the gate needs: the app-state store that already survives restarts. */
interface GateStore {
  getAppState<T>(key: string, fallback: T): T
  setAppState(key: string, value: unknown): void
}

/** JSON with object keys sorted, so equal inputs always serialize the same way. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/** A stable fingerprint of everything a background model call's output depends on, including model settings. */
export function fingerprint(input: unknown): string {
  return createHash('sha256')
    .update(canonical(input) ?? 'null')
    .digest('hex')
}

/**
 * Lets a background model call skip itself when its input is identical to the last successful run.
 * Call `shouldRun` before building a prompt and `record` only after the result was used, so a failed run retries.
 */
export class InputGate {
  constructor(private readonly store: GateStore) {}

  /** True when this job never succeeded with this fingerprint, or when `force` is set. */
  shouldRun(key: string, print: string, force = false): boolean {
    return force || this.store.getAppState<string | null>(`input-gate:${key}`, null) !== print
  }

  /** Remember a successful run. */
  record(key: string, print: string): void {
    this.store.setAppState(`input-gate:${key}`, print)
  }

  /** Forget a job's last run so the next one is not skipped. */
  clear(key: string): void {
    this.store.setAppState(`input-gate:${key}`, null)
  }
}
