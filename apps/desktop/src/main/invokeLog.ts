// Calls from the window that failed, kept beside the service's own log so a packaged app can be debugged after the
// fact: Electron prints a failed `ramu:invoke` only to a terminal nobody has open.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024
/** The same failure again this soon is counted, not written, so a reconnect loop cannot flood the file. */
const REPEAT_MS = 5_000
const STACK_LINES = 4

export interface InvokeLog {
  record(method: unknown, host: unknown, error: unknown): void
  /** A line about the app itself, such as a pause long enough for its connections to notice. */
  note(message: string): void
}

/**
 * A size-capped log of failed calls at `path`: the time, method, host and error with the top of its stack. Arguments are
 * never written, since they can carry prompts, file contents and credentials. Past the cap the file moves to `.1`.
 */
export function createInvokeLog(path: string, now: () => number = Date.now, maxBytes = MAX_BYTES): InvokeLog {
  const recent = new Map<string, { at: number; skipped: number }>()
  const write = (text: string) => {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try {
        if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`)
      } catch {
        // No file yet.
      }
      appendFileSync(path, `${text}\n`, { mode: 0o600 })
    } catch {
      // Logging must never turn a failed call into a different failure.
    }
  }
  return {
    note(message) {
      write(`${new Date(now()).toISOString()} ${message}`)
    },
    record(method, host, error) {
      const name = typeof method === 'string' ? method.slice(0, 200) : 'unknown'
      const on = typeof host === 'string' && host ? host.slice(0, 200) : 'this host'
      const message = error instanceof Error ? error.message : String(error)
      const code = (error as { code?: unknown } | null)?.code
      const key = `${name}\n${on}\n${message}`
      const at = now()
      const last = recent.get(key)
      if (last && at - last.at < REPEAT_MS) {
        last.skipped++
        return
      }
      recent.set(key, { at, skipped: 0 })
      if (recent.size > 200) recent.delete(recent.keys().next().value!)
      const stack =
        error instanceof Error && error.stack
          ? error.stack
              .split('\n')
              .slice(1, 1 + STACK_LINES)
              .map((line) => `    ${line.trim()}`)
          : []
      const repeats = last?.skipped ? ` (repeated ${last.skipped} more times)` : ''
      const line = [
        `${new Date(at).toISOString()} ${name} on ${on} failed${typeof code === 'string' ? ` [${code}]` : ''}: ${message}${repeats}`,
        ...stack,
      ].join('\n')
      write(line)
    },
  }
}
