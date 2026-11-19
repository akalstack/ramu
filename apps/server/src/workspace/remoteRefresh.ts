const FRESH_MS = 3 * 60_000
const MAX_FAILURE_WAIT_MS = 30 * 60_000
/** Credentials rarely fix themselves, but they are not gone for good either: try again now and then. */
const AUTH_FAILURE_WAIT_MS = 60 * 60_000
const MAX_REPOSITORIES = 256
const AUTH_FAILURE =
  /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey/i

interface Record {
  last: number
  failures: number
  authFailed: boolean
  running: boolean
}

/**
 * When a repository in view may reach its remote. Kept per repository on the host, so switching projects, reloading or
 * a second client never repeats a recent fetch or forgets that a remote is failing.
 */
export class RemoteRefresh {
  private readonly repositories = new Map<string, Record>()
  constructor(private readonly now: () => number = Date.now) {}

  private wait(record: Record): number {
    if (record.authFailed) return AUTH_FAILURE_WAIT_MS
    return record.failures ? Math.min(60_000 * 2 ** record.failures, MAX_FAILURE_WAIT_MS) : FRESH_MS
  }

  /** Runs `fetch` when one is due. Null means nothing ran; failures stay quiet and only lengthen the wait. */
  async visit<T>(key: string, fetch: () => Promise<T>): Promise<T | null> {
    const record = this.repositories.get(key) ?? { last: -Infinity, failures: 0, authFailed: false, running: false }
    if (record.running || this.now() - record.last < this.wait(record)) return null
    this.repositories.delete(key)
    this.repositories.set(key, record)
    while (this.repositories.size > MAX_REPOSITORIES) this.repositories.delete(this.repositories.keys().next().value!)
    record.last = this.now()
    record.running = true
    try {
      const result = await fetch()
      record.failures = 0
      record.authFailed = false
      return result
    } catch (error) {
      record.failures++
      record.authFailed = AUTH_FAILURE.test(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      record.running = false
    }
  }

  /** A fetch the person asked for just worked: it counts as fresh and clears any failure. */
  fetched(key: string) {
    this.repositories.set(key, { last: this.now(), failures: 0, authFailed: false, running: false })
  }
}
