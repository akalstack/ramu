import { describe, expect, it } from 'vitest'
import { hostStore, type Store } from '../src/hostStorage'

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  const store: Store & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
  return store
}

describe('hostStore', () => {
  it("keeps each host's keys apart and enumerates only its own", () => {
    const base = memory()
    const local = hostStore(base, 'local')
    const studio = hostStore(base, 'studio')
    local.setItem('ramu.unread', '["a"]')
    studio.setItem('ramu.unread', '["b"]')
    studio.setItem('ramu.draft.chat:1', 'x')
    expect(local.getItem('ramu.unread')).toBe('["a"]')
    expect(studio.getItem('ramu.unread')).toBe('["b"]')
    expect(local.length).toBe(1)
    expect(studio.length).toBe(2)
    expect(Array.from({ length: studio.length }, (_, i) => studio.key(i)).sort()).toEqual([
      'ramu.draft.chat:1',
      'ramu.unread',
    ])
    studio.removeItem('ramu.unread')
    expect(local.getItem('ramu.unread')).toBe('["a"]')
    expect(studio.getItem('ramu.unread')).toBeNull()
  })
})
