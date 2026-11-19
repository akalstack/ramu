import type { RamuBridge } from '@ramu/shared/api'
import type { Store } from './hostStorage'

/**
 * Device-wide UI state: panel widths, split or inline diffs, search view mode and the like. Every host has its own
 * window and its own web storage, so these values are kept by the desktop shell and shared with all windows; the page
 * only sees them through this object. Without that bridge (tests, a plain browser) it uses `local`.
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

export function createDeviceStorage(bridge: Bridge | undefined, local: Store | null): DeviceStorage {
  const listeners = new Set<(key: string) => void>()
  const notify = (key: string) => listeners.forEach((listener) => listener(key))
  const shared = bridge && typeof bridge.setDeviceState === 'function' ? bridge : undefined
  const values = new Map(Object.entries(shared?.deviceState ?? {}))
  const localKeys = () =>
    local
      ? Array.from({ length: local.length }, (_, index) => local.key(index)).filter((key): key is string => !!key)
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
      if (!shared) return safely(() => local?.getItem(key) ?? null, null)
      return values.get(key) ?? null
    },
    setItem(key, value) {
      if (shared) {
        if (values.get(key) === value) return
        values.set(key, value)
        shared.setDeviceState(key, value)
      } else safely(() => local?.setItem(key, value), undefined)
      notify(key)
    },
    removeItem(key) {
      if (shared) {
        values.delete(key)
        shared.setDeviceState(key, null)
      } else safely(() => local?.removeItem(key), undefined)
      notify(key)
    },
    keys(prefix) {
      const found = shared ? [...values.keys()] : localKeys()
      return found.filter((key) => key.startsWith(prefix))
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
