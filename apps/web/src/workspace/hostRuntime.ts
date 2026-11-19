// The per-host parts of a workspace store that are not React state: the host's bound `invoke`, its storage, its push
// events, its terminals and terminal activity. One instance per host, created when that host's store mounts.
// Framework-free and dependency-injected; workspace.tsx wires the real bridge.
import type { PushEvents, RamuBridge } from '@ramu/shared/api'
import type { ComputerStatus } from '@ramu/shared/types'
import type { HostStorage } from '../hostStorage'
import type { EventPump, HostChannel, HostEventRouter } from './hostEvents'
import { createTerminalActivity, type TerminalActivity } from './terminalActivity'
import { createTerminalRegistry, type TerminalRegistry } from './terminalRegistry'

export interface HostRuntime {
  id: string
  /** `invoke` bound to this host (`invokerFor(id)`). */
  invoke: RamuBridge['invoke']
  storage: HostStorage
  /** This host's push events only. */
  on<E extends HostChannel>(channel: E, listener: (payload: PushEvents[E]) => void): () => void
  /**
   * Applies work caused by an event. At once while the host is on screen (single-host behaviour, no added latency);
   * otherwise through the shared pump, coalesced by `key` and interleaved fairly with other hosts.
   */
  deliver(key: string, apply: () => void): void
  /** Whether this host's store is the one on screen. */
  readonly active: boolean
  setActive(active: boolean): void
  terminals: TerminalRegistry
  activity: TerminalActivity
  dispose(): void
}

export interface HostRuntimeDeps {
  invoke: RamuBridge['invoke']
  storage: HostStorage
  router: HostEventRouter
  pump: EventPump
  confirm?: (message: string) => boolean
  busyMessage?: (count: number) => string
}

export function createHostRuntime(id: string, deps: HostRuntimeDeps, active = true): HostRuntime {
  const on: HostRuntime['on'] = (channel, listener) => deps.router.on(id, channel, listener)
  const terminals = createTerminalRegistry({
    invoke: deps.invoke as never,
    on,
    confirm: deps.confirm,
    busyMessage: deps.busyMessage,
  })
  terminals.setActive(active)
  const runtime: HostRuntime = {
    id,
    invoke: deps.invoke,
    storage: deps.storage,
    on,
    deliver(key, apply) {
      if (active) apply()
      else deps.pump.defer(id, key, apply)
    },
    get active() {
      return active
    },
    setActive(next) {
      if (active === next) return
      active = next
      terminals.setActive(next)
      if (next) deps.pump.flush(id)
    },
    terminals,
    activity: createTerminalActivity(),
    dispose() {
      deps.pump.cancel(id)
    },
  }
  return runtime
}

/** Runtimes by host: created the first time a host's store asks (lazy), disposed when its store is no longer mounted. */
export function createRuntimeRegistry(create: (host: string) => HostRuntime) {
  const runtimes = new Map<string, HostRuntime>()
  return {
    get(host: string): HostRuntime {
      let runtime = runtimes.get(host)
      if (!runtime) {
        runtime = create(host)
        runtimes.set(host, runtime)
      }
      return runtime
    },
    has: (host: string) => runtimes.has(host),
    /** Disposes every runtime whose host is not in `hosts`. */
    retain(hosts: readonly string[]) {
      for (const [host, runtime] of runtimes)
        if (!hosts.includes(host)) {
          runtimes.delete(host)
          runtime.dispose()
        }
    },
    hosts: () => [...runtimes.keys()],
  }
}

/** Hosts something asked to see (phase 4: the sidebar, routes). Requests last until the host is forgotten. */
export function createMountRequests() {
  let requested: readonly string[] = []
  const listeners = new Set<() => void>()
  const set = (next: readonly string[]) => {
    if (next.length === requested.length && next.every((host, index) => requested[index] === host)) return
    requested = next
    for (const listener of listeners) listener()
  }
  return {
    request(host: string) {
      if (!requested.includes(host)) set([...requested, host])
    },
    /** Drops requests for hosts that are no longer saved. */
    retain(known: (host: string) => boolean) {
      set(requested.filter(known))
    },
    snapshot: () => requested,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** A requested host stays mounted, and subscribed, while it is connected or reconnecting. */
const LIVE: ComputerStatus[] = ['connected', 'connecting']

/**
 * Which hosts have a store: the window's own host and the active one always, plus each requested host while it is
 * live. Order is stable (own, active, then request order) so stores keep their place. A single-host window gets `[own]`.
 */
export function mountedHosts({
  own,
  active,
  requested,
  status,
}: {
  own: string
  active: string
  requested: readonly string[]
  status: (host: string) => ComputerStatus | null
}): string[] {
  const hosts = [own]
  if (!hosts.includes(active)) hosts.push(active)
  for (const host of requested) {
    const state = status(host)
    if (!hosts.includes(host) && state && LIVE.includes(state)) hosts.push(host)
  }
  return hosts
}
