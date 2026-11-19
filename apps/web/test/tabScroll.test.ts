import { afterEach, expect, it, vi } from 'vitest'
import { useTabScroll } from '../src/lib/useTabScroll'

const hook = vi.hoisted(() => ({ strip: null as unknown, cleanup: undefined as (() => void) | undefined }))
vi.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value === null ? hook.strip : value }),
  useLayoutEffect: (effect: () => () => void) => {
    hook.cleanup = effect()
  },
}))

afterEach(() => {
  hook.cleanup?.()
  vi.unstubAllGlobals()
})

it('keeps manual scrolling after scrollbar drag release, but reveals after a pane resize', () => {
  let mutation: MutationCallback = () => undefined
  let resize: ResizeObserverCallback = () => undefined
  let dragging = false
  class ElementStub {
    constructor(private split: boolean) {}
    matches() {
      return this.split
    }
  }
  vi.stubGlobal('Element', ElementStub)
  vi.stubGlobal('document', { querySelector: () => null, documentElement: {} })
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: MutationCallback) {
        mutation = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  const tab = { closest: () => null, getBoundingClientRect: () => ({ left: 200, right: 300 }) }
  const strip = {
    scrollLeft: 0,
    querySelector: () => tab,
    getBoundingClientRect: () => ({ left: 0, right: 100 }),
    parentElement: { querySelector: () => (dragging ? {} : null) },
    addEventListener() {},
    removeEventListener() {},
  }
  hook.strip = strip
  useTabScroll('active-tab')
  expect(strip.scrollLeft).toBe(200)

  strip.scrollLeft = 0
  dragging = true
  resize([], {} as ResizeObserver)
  expect(strip.scrollLeft).toBe(0)
  dragging = false
  mutation(
    [{ target: new ElementStub(false), attributeName: 'data-dragging' } as unknown as MutationRecord],
    {} as MutationObserver,
  )
  expect(strip.scrollLeft).toBe(0)

  mutation(
    [{ target: new ElementStub(true), attributeName: 'data-dragging' } as unknown as MutationRecord],
    {} as MutationObserver,
  )
  expect(strip.scrollLeft).toBe(200)
})
