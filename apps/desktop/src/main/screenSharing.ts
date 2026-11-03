import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import type { RuntimeResult } from '@ramu/client-runtime'

type Invoke = <M extends string>(
  target: unknown,
  method: M,
  args: unknown[],
  policy?: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<RuntimeResult<M>>

export interface ScreenSharingDeps {
  /** Calls a method on a host (a paired computer's endpoint) or on this computer's own service. */
  invoke: Invoke
  endpoint(id: string): unknown
  /** This computer's own service. */
  local: unknown
  connected(id: string): boolean
  name?: () => string
}

const POLL_MS = 25_000

/**
 * Lets a paired host use this computer's screen when the person opted in for that host. This computer polls the host for
 * commands, runs each on its own service, and posts the result. Nothing runs for a host that was not turned on here, and
 * the host's owner separately has to allow this computer.
 */
export class ScreenSharing {
  private enabled: Set<string>
  private loops = new Map<string, AbortController>()
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(
    private readonly file: string,
    private readonly deps: ScreenSharingDeps,
  ) {
    this.enabled = new Set(this.read())
  }

  private read(): string[] {
    try {
      const value = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : []
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
    } catch {
      return []
    }
  }

  list(): string[] {
    return [...this.enabled]
  }

  set(id: string, on: boolean): string[] {
    if (on) this.enabled.add(id)
    else this.enabled.delete(id)
    writeFileSync(this.file, JSON.stringify([...this.enabled]))
    this.sync()
    return this.list()
  }

  start() {
    this.sync()
    this.timer = setInterval(() => this.sync(), 5000)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const loop of this.loops.values()) loop.abort()
    this.loops.clear()
  }

  /** Starts a loop for every opted-in connected host, and ends the ones that are off, forgotten or disconnected. */
  sync() {
    for (const [id, loop] of this.loops)
      if (!this.enabled.has(id) || !this.deps.connected(id)) {
        loop.abort()
        this.loops.delete(id)
      }
    for (const id of this.enabled) {
      if (this.loops.has(id) || !this.deps.connected(id)) continue
      const controller = new AbortController()
      this.loops.set(id, controller)
      void this.run(id, controller.signal).finally(() => {
        if (this.loops.get(id) === controller) this.loops.delete(id)
      })
    }
  }

  private async run(id: string, signal: AbortSignal) {
    const host = this.deps.endpoint(id)
    const name = (this.deps.name ?? hostname)()
    let registered = false
    try {
      while (!signal.aborted) {
        try {
          if (!registered) {
            await this.deps.invoke(host, 'computerBroker.register', [name], { signal, timeoutMs: 15_000 })
            registered = true
          }
          const command = await this.deps.invoke(host, 'computerBroker.next', [POLL_MS], {
            signal,
            timeoutMs: POLL_MS + 15_000,
          })
          if (!command || signal.aborted) continue
          let outcome: { ok: true; value?: unknown } | { ok: false; error: string }
          try {
            outcome = {
              ok: true,
              value: await this.deps.invoke(this.deps.local, 'computer.brokerExec', [command], { timeoutMs: 30_000 }),
            }
          } catch (error) {
            outcome = { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 1900) }
          }
          await this.deps.invoke(host, 'computerBroker.result', [command.id, outcome], { signal, timeoutMs: 15_000 })
        } catch (error) {
          if (signal.aborted) break
          // The host rejected us (not allowed yet), restarted or went away: register again after a pause.
          registered = false
          await new Promise((resolve) => setTimeout(resolve, 5000))
        }
      }
    } finally {
      await this.deps.invoke(host, 'computerBroker.unregister', [], { timeoutMs: 5000 }).catch(() => {})
    }
  }
}
