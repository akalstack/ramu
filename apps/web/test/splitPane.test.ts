import { describe, expect, it } from 'vitest'
import { createDeviceStorage } from '../src/deviceStorage'
import { readSplitWidth, saveSplitWidth } from '../src/workspace/panelLayout'
import type { Store } from '../src/hostStorage'

const bounds = { initial: 480, min: 320, max: 720 }

const memory = () => {
  const data = new Map<string, string>()
  const store: Store = {
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

describe('split pane width', () => {
  it('starts at the initial width until one is dragged, then remembers it per page', () => {
    const storage = createDeviceStorage(undefined, memory())
    expect(readSplitWidth(storage, 'pull-requests', bounds)).toBe(480)
    saveSplitWidth(storage, 'pull-requests', bounds, 555.6)
    expect(readSplitWidth(storage, 'pull-requests', bounds)).toBe(556)
    expect(readSplitWidth(storage, 'other-page', bounds)).toBe(480)
  })

  it('keeps a dragged width inside the bounds', () => {
    const storage = createDeviceStorage(undefined, memory())
    saveSplitWidth(storage, 'pull-requests', bounds, 2000)
    expect(readSplitWidth(storage, 'pull-requests', bounds)).toBe(720)
    saveSplitWidth(storage, 'pull-requests', bounds, 10)
    expect(readSplitWidth(storage, 'pull-requests', bounds)).toBe(320)
  })

  it('ignores a stored width that is unreadable or outside narrower bounds', () => {
    const storage = createDeviceStorage(undefined, memory())
    saveSplitWidth(storage, 'pull-requests', bounds, 700)
    expect(readSplitWidth(storage, 'pull-requests', { initial: 300, min: 200, max: 600 })).toBe(300)
    storage.setItem('ramu.layout.split.pull-requests', 'wide')
    expect(readSplitWidth(storage, 'pull-requests', bounds)).toBe(480)
  })

  it('forgets the width when put back to the initial width or when layout sizes are reset', () => {
    const storage = createDeviceStorage(undefined, memory())
    saveSplitWidth(storage, 'pull-requests', bounds, 600)
    saveSplitWidth(storage, 'pull-requests', bounds, 480)
    expect(storage.keys('ramu.layout.split.')).toEqual([])

    // Settings' reset of layout sizes removes every key under the layout prefix.
    saveSplitWidth(storage, 'pull-requests', bounds, 600)
    for (const key of storage.keys('ramu.layout.')) storage.removeItem(key)
    expect(readSplitWidth(storage, 'pull-requests', bounds)).toBe(480)
  })
})
