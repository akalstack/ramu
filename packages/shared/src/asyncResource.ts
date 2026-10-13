/** A cached resource shared by many consumers, with coalesced reads and durable invalidation. */
export function createSharedResource<T>(load: () => Promise<T>, initial: T) {
  let snapshot: { value: T; loaded: boolean; error: string | null } = { value: initial, loaded: false, error: null }
  const listeners = new Set<() => void>()
  let request: Promise<void> | null = null, refreshPending = false
  const publish = () => listeners.forEach((listener) => listener())
  const reload = (): Promise<void> => {
    if (request) return request
    request = load().then((value) => { snapshot = { value, loaded: true, error: null }; publish() }, (error) => { snapshot = { ...snapshot, error: String(error) }; publish() }).finally(() => {
      request = null
      if (refreshPending) { refreshPending = false; void reload() }
    })
    return request
  }
  return {
    getSnapshot: () => snapshot,
    reload,
    invalidate: () => { if (request) refreshPending = true; else void reload() },
    subscribe: (listener: () => void) => { listeners.add(listener); if (listeners.size === 1) void reload(); return () => { listeners.delete(listener) } },
  }
}
