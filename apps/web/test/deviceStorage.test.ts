import { describe, expect, it, vi } from 'vitest'
import { createDeviceStorage } from '../src/deviceStorage'
import type { Store } from '../src/hostStorage'

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
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
const bridge = (deviceState: Record<string, string> = {}) => {
  let listener: ((event: { key: string; value: string | null }) => void) | undefined
  return {
    deviceState,
    setDeviceState: vi.fn<(key: string, value: string | null) => void>(),
    on: ((_event: string, next: typeof listener) => {
      listener = next
      return () => {}
    }) as never,
    emit: (key: string, value: string | null) => listener?.({ key, value }),
  }
}

describe('deviceStorage with the desktop bridge', () => {
  it('reads the shared snapshot and writes through to the other windows', () => {
    const b = bridge({ 'ramu.sidebar-width': '300' })
    const storage = createDeviceStorage(b, memory())
    expect(storage.getItem('ramu.sidebar-width')).toBe('300')
    storage.setItem('ramu.sidebar-width', '320')
    expect(storage.getItem('ramu.sidebar-width')).toBe('320')
    expect(b.setDeviceState).toHaveBeenCalledWith('ramu.sidebar-width', '320')
    storage.removeItem('ramu.sidebar-width')
    expect(storage.getItem('ramu.sidebar-width')).toBeNull()
    expect(b.setDeviceState).toHaveBeenLastCalledWith('ramu.sidebar-width', null)
  })

  it('does not echo unchanged values back to the shell', () => {
    const b = bridge({ 'ramu.word-wrap': 'on' })
    createDeviceStorage(b, memory()).setItem('ramu.word-wrap', 'on')
    expect(b.setDeviceState).not.toHaveBeenCalled()
  })

  it('adopts a value this window stored locally before it was shared, once', () => {
    const legacy = memory({ 'ramu.layout.tools-rail': '340' })
    const b = bridge()
    const storage = createDeviceStorage(b, legacy)
    expect(storage.getItem('ramu.layout.tools-rail')).toBe('340')
    expect(b.setDeviceState).toHaveBeenCalledWith('ramu.layout.tools-rail', '340')
    expect(legacy.getItem('ramu.layout.tools-rail')).toBeNull()
    expect(storage.getItem('ramu.layout.tools-rail')).toBe('340')
    expect(b.setDeviceState).toHaveBeenCalledTimes(1)
  })

  it("prefers the value another window already shared over this window's old one", () => {
    const storage = createDeviceStorage(bridge({ 'ramu.search-view': 'tree' }), memory({ 'ramu.search-view': 'list' }))
    expect(storage.getItem('ramu.search-view')).toBe('tree')
  })

  it('follows changes made in another window and tells subscribers', () => {
    const b = bridge({ 'ramu.sidebar-width': '300' })
    const storage = createDeviceStorage(b, memory())
    const seen: string[] = []
    const off = storage.subscribe((key) => seen.push(key))
    b.emit('ramu.sidebar-width', '360')
    expect(storage.getItem('ramu.sidebar-width')).toBe('360')
    b.emit('ramu.sidebar-width', null)
    expect(storage.getItem('ramu.sidebar-width')).toBeNull()
    expect(seen).toEqual(['ramu.sidebar-width', 'ramu.sidebar-width'])
    off()
    b.emit('ramu.sidebar-width', '400')
    expect(seen).toHaveLength(2)
  })

  it('lists keys by prefix across shared and old local values', () => {
    const storage = createDeviceStorage(
      bridge({ 'ramu.layout.tools-rail': '1', 'ramu.search-view': 'list' }),
      memory({ 'ramu.layout.react-resizable-panels:scm': '{}' }),
    )
    expect(storage.keys('ramu.layout.').sort()).toEqual([
      'ramu.layout.react-resizable-panels:scm',
      'ramu.layout.tools-rail',
    ])
  })
})

describe('deviceStorage without a bridge', () => {
  it('falls back to the local store', () => {
    const legacy = memory()
    const storage = createDeviceStorage(undefined, legacy)
    storage.setItem('ramu.word-wrap', 'on')
    expect(legacy.getItem('ramu.word-wrap')).toBe('on')
    expect(storage.getItem('ramu.word-wrap')).toBe('on')
    storage.removeItem('ramu.word-wrap')
    expect(storage.getItem('ramu.word-wrap')).toBeNull()
  })

  it('works with no storage at all', () => {
    const storage = createDeviceStorage(undefined, null)
    expect(() => storage.setItem('ramu.a', '1')).not.toThrow()
    expect(storage.getItem('ramu.a')).toBeNull()
    expect(storage.keys('ramu.')).toEqual([])
  })
})
