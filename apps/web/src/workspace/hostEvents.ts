// Push events by host. Framework-free and bridge-injected so it can be tested without a window.
import type { PushEvents, RamuBridge } from '@ramu/shared/api'
import { type HostPushChannel } from '@ramu/shared/pushChannels'

/**
 * Channels whose payload belongs to one host's server (`HOST_PUSH_CHANNELS`, shared with the preload and the main
 * process). Everything else (`workspace:visibility`, `workspace:checkpoint`, `computers:*`, `device-state:changed`,
 * `updates:changed`, `menu:action`, `notify:*`, ...) is about this window or this machine and stays on plain `ramu.on`.
 */
export type HostChannel = HostPushChannel

type Listener<E extends HostChannel> = (payload: PushEvents[E]) => void
/** How listeners of every channel are kept together; each only ever receives its own channel's payload. */
type AnyListener = (payload: never) => void

export interface HostEventRouter {
  /** Listens to `channel`, but only to events of `host`. */
  on<E extends HostChannel>(host: string, channel: E, listener: Listener<E>): () => void
}

/**
 * One bridge subscription per channel, fanned out by host. An event without a host (the main process runs without
 * host events, or delivers per window) belongs to the window's own host, so a single-host window behaves as before.
 */
export function createHostEventRouter(bridge: Pick<RamuBridge, 'on'>, ownHost: () => string): HostEventRouter {
  const channels = new Map<HostChannel, { off: () => void; hosts: Map<string, Set<AnyListener>> }>()
  return {
    on(host, channel, listener) {
      let entry = channels.get(channel)
      if (!entry) {
        const hosts = new Map<string, Set<AnyListener>>()
        const off = bridge.on(channel, (payload, from) => {
          const listeners = hosts.get(from ?? ownHost())
          if (listeners) for (const deliver of [...listeners]) (deliver as Listener<typeof channel>)(payload)
        })
        entry = { off, hosts }
        channels.set(channel, entry)
      }
      const listeners = entry.hosts.get(host) ?? new Set()
      entry.hosts.set(host, listeners)
      listeners.add(listener)
      return () => {
        const current = channels.get(channel)
        const set = current?.hosts.get(host)
        if (!current || !set?.delete(listener)) return
        if (!set.size) current.hosts.delete(host)
        if (!current.hosts.size) {
          current.off()
          channels.delete(channel)
        }
      }
    },
  }
}

/**
 * The bridge as seen by code that only knows the window's own host: `on` drops events another host sent (the window on
 * screen also gets the host events of the other hosts it shows). Untagged events belong to the window's own host. Host-aware code uses the raw bridge through the router instead.
 */
export function ownHostOnly<B extends Pick<RamuBridge, 'on'>>(bridge: B, ownHost: () => string): B {
  if (!bridge) return bridge
  const on: RamuBridge['on'] = (event, listener) =>
    bridge.on(event, (payload, host) => {
      if (host === undefined || host === ownHost()) listener(payload, host)
    })
  // Electron freezes contextBridge values. A proxy cannot replace a frozen target's `on` property.
  return { ...bridge, on }
}

export interface EventPump {
  /**
   * Applies `apply` soon, for a host that is not on screen. Work under the same `key` coalesces (the latest wins), so a
   * burst of the same trigger runs once, and each turn gives every host a fair share so a busy host cannot starve the
   * others or the UI.
   */
  defer(host: string, key: string, apply: () => void): void
  /** Runs a host's pending work now (it was just brought on screen). */
  flush(host: string): void
  /** Drops a host's pending work (its store unmounted). */
  cancel(host: string): void
  pending(host?: string): number
}

export function createEventPump({
  schedule = (run: () => void) => void setTimeout(run, 0),
  budget = 32,
  report = (error: unknown) => console.error(error),
}: { schedule?: (run: () => void) => void; budget?: number; report?: (error: unknown) => void } = {}): EventPump {
  const queues = new Map<string, Map<string, () => void>>()
  let scheduled = false
  const run = (apply: () => void) => {
    try {
      apply()
    } catch (error) {
      report(error)
    }
  }
  const tick = () => {
    scheduled = false
    let left = budget
    // Round-robin, one item per host per pass, until the turn's budget is spent.
    while (left > 0 && queues.size) {
      for (const [host, queue] of [...queues]) {
        if (left <= 0) break
        const next = queue.entries().next()
        if (next.done) {
          queues.delete(host)
          continue
        }
        const [key, apply] = next.value
        queue.delete(key)
        if (!queue.size) queues.delete(host)
        // Rotate: a host that just ran goes to the back, so the next turn starts with someone else.
        else {
          queues.delete(host)
          queues.set(host, queue)
        }
        left--
        run(apply)
      }
    }
    if (queues.size) arm()
  }
  const arm = () => {
    if (scheduled) return
    scheduled = true
    schedule(tick)
  }
  return {
    defer(host, key, apply) {
      const queue = queues.get(host) ?? new Map<string, () => void>()
      queues.set(host, queue)
      queue.set(key, apply)
      arm()
    },
    flush(host) {
      const queue = queues.get(host)
      queues.delete(host)
      if (queue) for (const apply of queue.values()) run(apply)
    },
    cancel(host) {
      queues.delete(host)
    },
    pending(host) {
      if (host !== undefined) return queues.get(host)?.size ?? 0
      let total = 0
      for (const queue of queues.values()) total += queue.size
      return total
    },
  }
}
