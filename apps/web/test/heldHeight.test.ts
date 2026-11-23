import { afterEach, expect, it, vi } from 'vitest'
import { HOLD_PAUSE_MS } from '@ramu/shared/chat/heldHeight'
import { useHeldHeight } from '../src/views/agent/hooks/useHeldHeight'

// A minimal React for one component: state and refs keep their slot across renders, and a layout effect runs when
// its dependencies change.
const react = vi.hoisted(() => ({
  element: null as unknown,
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
}))
vi.mock('react', () => {
  const slot = <T>(make: () => T): T => {
    const index = react.cursor++
    if (!(index in react.slots)) react.slots[index] = make()
    return react.slots[index] as T
  }
  return {
    useRef: (value: unknown) => slot(() => ({ current: value === null ? react.element : value })),
    useState: (initial: () => unknown) => [slot(initial)],
    useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const previous = slot<{ deps?: unknown[] }>(() => ({}))
      if (previous.deps && deps.every((dep, i) => Object.is(dep, previous.deps![i]))) return
      previous.deps = deps
      const cleanup = effect()
      if (cleanup) react.cleanups.push(cleanup)
    },
  }
})

let resize: () => void = () => undefined
const element = { offsetHeight: 40, style: { minHeight: '' } }
const useGroup = (live: boolean, identity = 'a') => {
  react.cursor = 0
  return useHeldHeight<HTMLElement>(live, identity)
}

afterEach(() => {
  react.cleanups.forEach((cleanup) => cleanup())
  react.cleanups = []
  react.slots = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const setUp = () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  element.offsetHeight = 40
  element.style.minHeight = ''
  react.element = element
}

it('holds a live folded group at its tallest height, then lets go once it is no longer live', () => {
  setUp()
  useGroup(true)
  expect(element.style.minHeight).toBe('40px')
  element.offsetHeight = 96
  resize()
  expect(element.style.minHeight).toBe('96px')
  // A line went away inside: the group keeps its height, so the transcript does not move.
  element.offsetHeight = 60
  resize()
  expect(element.style.minHeight).toBe('96px')
  useGroup(false)
  expect(element.style.minHeight).toBe('')
})

it('lets a fold by hand show, then holds again from where it settled', () => {
  vi.useFakeTimers()
  setUp()
  const held = useGroup(true)
  element.offsetHeight = 200
  resize()
  held.release()
  expect(element.style.minHeight).toBe('')
  element.offsetHeight = 120
  resize()
  expect(element.style.minHeight).toBe('')
  element.offsetHeight = 50
  vi.advanceTimersByTime(HOLD_PAUSE_MS)
  expect(element.style.minHeight).toBe('50px')
})

it('settles group A once it is done, and starts group B from its own height', () => {
  setUp()
  useGroup(true, 'a')
  element.offsetHeight = 120
  resize()
  expect(element.style.minHeight).toBe('120px')
  // A is done (the agent replied after it): it settles once, while the turn still runs.
  useGroup(false, 'a')
  expect(element.style.minHeight).toBe('')
  // B is drawn in the same place: it never inherits A's height.
  element.offsetHeight = 40
  useGroup(true, 'b')
  expect(element.style.minHeight).toBe('40px')
})

it('drops a held height when a different group takes the place mid-hold', () => {
  setUp()
  useGroup(true, 'a')
  element.offsetHeight = 120
  resize()
  element.offsetHeight = 30
  useGroup(true, 'b')
  expect(element.style.minHeight).toBe('30px')
})
