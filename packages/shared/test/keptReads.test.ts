import { describe, expect, it } from 'vitest'
import { keptReadKey, keptReads } from '../src/keptReads'

const memory = (removable = true) => {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    ...(removable ? { removeItem: (key: string) => void items.delete(key) } : {}),
  }
}

describe('kept reads', () => {
  it('opens on the last answer to the same read, and nothing for another', () => {
    const kept = keptReads(memory(), 'prs')
    kept.write(keptReadKey('forge.allPullRequests', false), [{ url: 'a' }])
    expect(kept.read(keptReadKey('forge.allPullRequests', false))).toEqual([{ url: 'a' }])
    expect(kept.read(keptReadKey('forge.allPullRequests', true))).toBeUndefined()
  })

  it('keeps only the most recently saved reads', () => {
    const store = memory()
    const kept = keptReads(store, 'prs', { max: 2 })
    kept.write('a', 1)
    kept.write('b', 2)
    kept.write('a', 3)
    kept.write('c', 4)
    expect([kept.read('a'), kept.read('b'), kept.read('c')]).toEqual([3, undefined, 4])
    expect(store.items.has('prs:b')).toBe(false)
  })

  it('leaves out an answer too large to keep, dropping the older copy so a stale one never shows', () => {
    const kept = keptReads(memory(false), 'prs', { maxBytes: 10 })
    kept.write('a', 'short')
    kept.write('a', 'x'.repeat(50))
    expect(kept.read('a')).toBeUndefined()
  })

  it('reads nothing, and never throws, without storage or from a broken entry', () => {
    expect(keptReads(null, 'prs').read('a')).toBeUndefined()
    const store = memory()
    store.items.set('prs:a', '{broken')
    expect(keptReads(store, 'prs').read('a')).toBeUndefined()
  })
})
