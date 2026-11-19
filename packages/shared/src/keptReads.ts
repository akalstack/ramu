/** The slice of a key-value store kept reads need; web storage and the phone's content cache both fit. */
export interface KeptStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/**
 * The last answers to a few reads, kept on this device so a page opens on what it showed last time instead of empty,
 * then reads again. Bounded: the `max` most recently saved reads are kept, and an answer larger than `maxBytes` is not.
 */
export function keptReads(store: KeptStore | null, name: string, { max = 40, maxBytes = 250_000 } = {}) {
  const indexKey = `${name}:index`
  const entryKey = (key: string) => `${name}:${key}`
  const index = (): string[] => {
    try {
      const saved = JSON.parse(store?.getItem(indexKey) ?? '[]') as unknown
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : []
    } catch {
      return []
    }
  }
  const drop = (key: string) => {
    if (store?.removeItem) store.removeItem(entryKey(key))
    else store?.setItem(entryKey(key), '')
  }
  return {
    read<T>(key: string): T | undefined {
      try {
        const text = store?.getItem(entryKey(key))
        return text ? (JSON.parse(text) as T) : undefined
      } catch {
        return undefined
      }
    },
    write(key: string, value: unknown): void {
      if (!store || value === undefined) return
      try {
        const text = JSON.stringify(value)
        const kept = index().filter((entry) => entry !== key)
        if (text.length > maxBytes) {
          drop(key)
          store.setItem(indexKey, JSON.stringify(kept))
          return
        }
        store.setItem(entryKey(key), text)
        const next = [key, ...kept]
        for (const old of next.slice(max)) drop(old)
        store.setItem(indexKey, JSON.stringify(next.slice(0, max)))
      } catch {
        // Storage full or unavailable: the page still reads from the host, it only opens empty next time.
      }
    },
  }
}

/** One read's key: the method and its arguments. */
export const keptReadKey = (method: string, ...args: unknown[]) => JSON.stringify([method, ...args])
