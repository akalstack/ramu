import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { animateThreadListChange } from '../src/workspace/threadListMotion'

const state = vi.hoisted(() => ({ reduced: false }))
vi.mock('../src/workspace/panelMotion', () => ({ reducedMotion: () => state.reduced }))

class Row {
  isConnected = true
  style = {}
  inert = false
  remove = vi.fn()
  removeAttribute = vi.fn()
  setAttribute = vi.fn()
  animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
  constructor(public top = 0) {}
  getBoundingClientRect() {
    return { left: 10, top: this.top, bottom: this.top + 30, width: 200, height: 30 }
  }
  cloneNode() {
    return new Row(this.top)
  }
  querySelectorAll() {
    return []
  }
  querySelector() {
    return null
  }
  matches() {
    return true
  }
  closest() {
    return this
  }
}
let rows: Row[]
let notify: MutationCallback
let frame: FrameRequestCallback | undefined
const disconnect = vi.fn()
const append = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  state.reduced = false
  rows = []
  frame = undefined
  append.mockClear()
  disconnect.mockClear()
  vi.stubGlobal('Element', Row)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('document', {
    hidden: false,
    documentElement: {},
    body: { append },
    querySelectorAll: () => rows,
    addEventListener() {},
    removeEventListener() {},
  })
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'cubic-bezier(0.2, 0.7, 0.2, 1)' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: MutationCallback) {
        notify = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const changed = (removed: Row[] = [], added: Row[] = []) => {
  notify(
    [{ target: {}, removedNodes: removed, addedNodes: added } as unknown as MutationRecord],
    {} as MutationObserver,
  )
  frame?.(0)
}

it('starts the action immediately, fades a removed row and shifts remaining rows into place', async () => {
  const first = new Row(0),
    second = new Row(30)
  rows = [first, second]
  const action = vi.fn(async () => {
    rows = [second]
    first.isConnected = false
    second.top = 0
    changed([first])
    return 'done'
  })
  const result = animateThreadListChange(action)
  expect(action).toHaveBeenCalledOnce()
  expect(await result).toBe('done')
  expect(second.animate.mock.calls[0]).toEqual([
    [{ transform: 'translate(0px, 30px)' }, { transform: 'none' }],
    { duration: 180, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  ])
  const ghost = append.mock.calls[0]![0] as Row
  expect(ghost.inert).toBe(true)
  expect(ghost.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true')
  expect(ghost.remove).toHaveBeenCalledOnce()
})

it('animates entries even when a different host has a row with identical text or IDs', async () => {
  const existing = new Row(),
    incoming = new Row(30)
  rows = [existing]
  await animateThreadListChange(async () => {
    rows = [existing, incoming]
    changed([], [incoming])
  })
  expect(existing.animate).not.toHaveBeenCalled()
  expect(incoming.animate).toHaveBeenCalledOnce()
})

it('preserves failed actions and does not fabricate a removed row', async () => {
  rows = [new Row()]
  await expect(
    animateThreadListChange(async () => {
      throw new Error('Offline')
    }),
  ).rejects.toThrow('Offline')
  expect(append).not.toHaveBeenCalled()
})

it('skips visual work for reduced motion without changing the action result', async () => {
  state.reduced = true
  const action = vi.fn(async () => 42)
  expect(await animateThreadListChange(action)).toBe(42)
  expect(action).toHaveBeenCalledOnce()
  expect(append).not.toHaveBeenCalled()
})
