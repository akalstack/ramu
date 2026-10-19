import type { RamuBridge } from '@ramu/shared/api'
import type { Store } from './hostStorage'

/**
 * Device-wide UI state: panel widths, split or inline diffs, search view mode and the like. Every host has its own
 * window and its own web storage, so these values are kept by the desktop shell and shared with all windows; the page
 * only sees them through this object. Without that bridge (tests, a plain browser) it falls back to `legacy`.
 */
export interface DeviceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** Keys that start with `prefix`. */
  keys(prefix: string): string[]
  /** Runs when any key changes here or in another window. Returns the unsubscribe function. */
  subscribe(listener: (key: string) => void): () => void
}

type Bridge = Pick<RamuBridge, 'deviceState' | 'setDeviceState' | 'on'>

export function createDeviceStorage(bridge: Bridge | undefined, legacy: Store | null): DeviceStorage {
  const listeners = new Set<(key: string) => void>()
  const notify = (key: string) => listeners.forEach((listener) => listener(key))
  const shared = bridge && typeof bridge.setDeviceState === 'function' ? bridge : undefined
  const values = new Map(Object.entries(shared?.deviceState ?? {}))
  const legacyKeys = () =>
    legacy
      ? Array.from({ length: legacy.length }, (_, index) => legacy.key(index)).filter((key): key is string => !!key)
      : []
  const safely = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
  let subscribed = false
  const listen = () => {
    if (subscribed || !shared || typeof shared.on !== 'function') return
    subscribed = true
    shared.on('device-state:changed', ({ key, value }) => {
      if (value === null) values.delete(key)
      else values.set(key, value)
      notify(key)
    })
  }
  listen()
  return {
    getItem(key) {
      if (!shared) return safely(() => legacy?.getItem(key) ?? null, null)
      const current = values.get(key)
      if (current !== undefined) return current
      // First sight of a value this window wrote before it was shared: adopt it, so nothing resets on upgrade.
      const old = safely(() => legacy?.getItem(key) ?? null, null)
      if (old === null) return null
      values.set(key, old)
      shared.setDeviceState(key, old)
      safely(() => legacy?.removeItem(key), undefined)
      return old
    },
    setItem(key, value) {
      if (shared) {
        if (values.get(key) === value) return
        values.set(key, value)
        shared.setDeviceState(key, value)
        safely(() => legacy?.removeItem(key), undefined)
      } else safely(() => legacy?.setItem(key, value), undefined)
      notify(key)
    },
    removeItem(key) {
      if (shared) {
        values.delete(key)
        shared.setDeviceState(key, null)
      }
      safely(() => legacy?.removeItem(key), undefined)
      notify(key)
    },
    keys(prefix) {
      const found = new Set<string>(shared ? values.keys() : [])
      for (const key of legacyKeys()) found.add(key)
      return [...found].filter((key) => key.startsWith(prefix))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const browserStorage = (): Store | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export const deviceStorage = createDeviceStorage(globalThis.window?.ramu, browserStorage())
