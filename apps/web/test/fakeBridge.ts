import { vi } from 'vitest'

/** A bridge whose `on` can be fired by hand, with or without a host, like the preload. */
export function fakeBridge() {
  const listeners = new Map<string, Set<(payload: any, host?: string) => void>>()
  return {
    on: vi.fn((event: string, listener: (payload: any, host?: string) => void) => {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(listener)
      return () => set.delete(listener)
    }),
    emit(event: string, payload: unknown, host?: string) {
      for (const listener of listeners.get(event) ?? []) listener(payload, host)
    },
    count: (event: string) => listeners.get(event)?.size ?? 0,
  }
}
