import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceState, type DeviceFiles } from '../src/main/deviceState'

const memory = (initial?: string) => {
  const writes: string[] = []
  const files: DeviceFiles = {
    read: () => {
      if (initial === undefined) throw new Error('ENOENT')
      return initial
    },
    write: (_file, content) => {
      writes.push(content)
    },
  }
  return { files, writes }
}
afterEach(() => vi.useRealTimers())

describe('DeviceState', () => {
  it('starts empty without a file and keeps only valid saved entries', () => {
    expect(new DeviceState('f', memory().files).snapshot()).toEqual({})
    const saved = JSON.stringify({
      'ramu.layout.tools-rail': '300',
      other: '1',
      'ramu.big': 'x'.repeat(70_000),
      'ramu.n': 5,
    })
    expect(new DeviceState('f', memory(saved).files).snapshot()).toEqual({ 'ramu.layout.tools-rail': '300' })
    expect(new DeviceState('f', memory('{not json').files).snapshot()).toEqual({})
  })

  it('reports changes, ignores repeats, and removes with null', () => {
    const state = new DeviceState('f', memory().files)
    expect(state.set('ramu.sidebar-width', '300')).toBe(true)
    expect(state.set('ramu.sidebar-width', '300')).toBe(false)
    expect(state.set('ramu.sidebar-width', '320')).toBe(true)
    expect(state.snapshot()).toEqual({ 'ramu.sidebar-width': '320' })
    expect(state.set('ramu.sidebar-width', null)).toBe(true)
    expect(state.set('ramu.sidebar-width', null)).toBe(false)
    expect(state.snapshot()).toEqual({})
  })

  it('rejects keys and values a page should not be able to store', () => {
    const state = new DeviceState('f', memory().files)
    expect(() => state.set('sidebar', '1')).toThrow('Invalid device setting')
    expect(() => state.set('ramu.ok', 7)).toThrow('Invalid device setting')
    expect(() => state.set('ramu.ok', 'x'.repeat(64 * 1024 + 1))).toThrow('Invalid device setting')
    expect(() => state.set('ramu.' + 'k'.repeat(200), '1')).toThrow('Invalid device setting')
    expect(() => state.set({}, null)).toThrow('Invalid device setting')
    for (let i = 0; i < 500; i++) state.set(`ramu.k${i}`, '1')
    expect(() => state.set('ramu.extra', '1')).toThrow('Too many')
    expect(state.set('ramu.k0', '2')).toBe(true)
  })

  it('writes once after a burst, and flush writes immediately', () => {
    vi.useFakeTimers()
    const { files, writes } = memory()
    const state = new DeviceState('f', files, 200)
    state.set('ramu.a', '1')
    state.set('ramu.a', '2')
    state.set('ramu.b', '3')
    expect(writes).toEqual([])
    vi.advanceTimersByTime(250)
    expect(writes).toEqual([JSON.stringify({ 'ramu.a': '2', 'ramu.b': '3' })])
    state.set('ramu.c', '4')
    state.flush()
    expect(writes).toHaveLength(2)
    state.flush()
    expect(writes).toHaveLength(2)
  })
})
