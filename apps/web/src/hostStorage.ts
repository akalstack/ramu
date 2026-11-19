import { ownHostId } from './hosts'

/** What the layout and draft code needs from a storage area. `localStorage` and a host-scoped view both fit. */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const NAMESPACE = 'host:'

const allKeys = (store: Store) =>
  Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => key !== null)

/** A view of `base` where every key lives under one host. Enumeration (`key`, `length`) only sees that host's keys. */
export function hostStore(base: Store, host: string): Store {
  const prefix = `${NAMESPACE}${host}:`
  const own = () => allKeys(base).filter((key) => key.startsWith(prefix))
  return {
    getItem: (key) => base.getItem(prefix + key),
    setItem: (key, value) => base.setItem(prefix + key, value),
    removeItem: (key) => base.removeItem(prefix + key),
    key: (index) => own()[index]?.slice(prefix.length) ?? null,
    get length() {
      return own().length
    },
  }
}

let own: Store | null | undefined
/** Storage for this window's host. */
export function ownHostStore(): Store | null {
  if (own !== undefined) return own
  try {
    const base = globalThis.localStorage ?? null
    if (!base) return (own = null)
    own = hostStore(base, ownHostId())
  } catch {
    own = null
  }
  return own
}

const others = new Map<string, Store>()
/** Storage for any host: a namespaced view of this window's storage. */
export function storeForHost(host: string): Store | null {
  if (host === ownHostId()) return ownHostStore()
  const cached = others.get(host)
  if (cached) return cached
  try {
    const base = globalThis.localStorage ?? null
    if (!base) return null
    const store = hostStore(base, host)
    others.set(host, store)
    return store
  } catch {
    return null
  }
}

/** Silent drop-in like `hostStorage`, for one named host. */
export interface HostStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export const hostStorageFor = (host: string): HostStorage => ({
  getItem: (key) => storeForHost(host)?.getItem(key) ?? null,
  setItem: (key, value) => storeForHost(host)?.setItem(key, value),
  removeItem: (key) => storeForHost(host)?.removeItem(key),
})

/** Every `ramu.layout.*` key of this host (per-workspace layout), for the Settings reset. */
export function clearOwnHostLayout() {
  const store = ownHostStore()
  if (!store) return
  for (const key of allKeys(store)) if (key.startsWith('ramu.layout.')) store.removeItem(key)
}

/**
 * Drop-in for `localStorage` calls that hold per-host state: same method names, scoped to this window's host, and
 * silent when storage is unavailable. Callers keep their own try/catch around writes.
 */
export const hostStorage = {
  getItem: (key: string): string | null => ownHostStore()?.getItem(key) ?? null,
  setItem: (key: string, value: string): void => ownHostStore()?.setItem(key, value),
  removeItem: (key: string): void => ownHostStore()?.removeItem(key),
}
