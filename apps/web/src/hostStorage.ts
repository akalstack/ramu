import { ownHostId } from './hosts'

/** What the layout and draft code needs from a storage area. `localStorage` and a host-scoped view both fit. */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

/**
 * Per-host state: anything keyed by an id that only means something on one host (chats, projects, workspaces) or that
 * describes a host's own content (unread marks, drafts, the outbox, per-workspace layout). Device-wide choices such as
 * panel widths live in `deviceStorage` instead; they are the same whichever host is shown.
 */
const PER_HOST_EXACT = new Set([
  'ramu.unread',
  'ramu.workspace.resume',
  'ramu.outbox',
  'ramu.saved-drafts',
  'ramu.navigation-locations',
  'ramu.last-project',
])
const PER_HOST_PREFIXES = [
  'ramu.draft.',
  'ramu.new-thread-workspace:',
  'ramu.new-thread-agent:',
  'ramu.last-action:',
  'ramu.review-viewed:',
  'ramu.layout.',
]
/** `ramu.layout.*` keys that are device-wide even though they share the prefix. */
const DEVICE_LAYOUT = ['ramu.layout.tools-rail', 'ramu.layout.react-resizable-panels:']

/** Whether a key written before hosts were namespaced belongs to the host that wrote it. */
export const isPerHostKey = (key: string) =>
  !DEVICE_LAYOUT.some((prefix) => key.startsWith(prefix)) &&
  (PER_HOST_EXACT.has(key) || PER_HOST_PREFIXES.some((prefix) => key.startsWith(prefix)))

const NAMESPACE = 'host:'
const MARKER = 'ramu.host-storage'

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

/**
 * One-time move of keys written before namespacing. A window only ever stored its own host's state (each host has its
 * own storage partition), so the keys go to that window's host, not necessarily the local one. Runs once per storage
 * area, never overwrites a namespaced key, and leaves device-wide keys where they are.
 */
export function migrateLegacyHostKeys(base: Store, host: string): number {
  if (base.getItem(MARKER) !== null) return 0
  let moved = 0
  const prefix = `${NAMESPACE}${host}:`
  for (const key of allKeys(base)) {
    if (key.startsWith(NAMESPACE) || !isPerHostKey(key)) continue
    const value = base.getItem(key)
    if (value !== null && base.getItem(prefix + key) === null) {
      base.setItem(prefix + key, value)
      moved++
    }
    base.removeItem(key)
  }
  base.setItem(MARKER, host)
  return moved
}

let own: Store | null | undefined
/** Storage for this window's host. Migrates old keys on first use, before anything reads them. */
export function ownHostStore(): Store | null {
  if (own !== undefined) return own
  try {
    const base = globalThis.localStorage ?? null
    if (!base) return (own = null)
    const host = ownHostId()
    try {
      migrateLegacyHostKeys(base, host)
    } catch {
      // A full or locked store keeps working under the new keys; old values are simply not carried over.
    }
    own = hostStore(base, host)
  } catch {
    own = null
  }
  return own
}

const others = new Map<string, Store>()
/**
 * Storage for any host. The window's own host is `ownHostStore()` (with its migration); another host gets a namespaced
 * view of this window's storage. Legacy partition content is imported by the shell preload before these keys are read.
 */
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
