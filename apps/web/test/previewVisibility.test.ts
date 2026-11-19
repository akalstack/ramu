import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ near: false, cleanup: undefined as (() => void) | undefined }))
vi.mock('react', () => ({
  useState: () => [
    h.near,
    (next: boolean) => {
      h.near = next
    },
  ],
  startTransition: (run: () => void) => run(),
  useEffect: (run: () => void | (() => void)) => {
    h.cleanup = run() || undefined
  },
}))
import { useNearViewport } from '../src/lib/useNearViewport'
let observe: (entries: { target: unknown; isIntersecting: boolean }[]) => void
const element = { contains: () => true }
beforeEach(() => {
  h.near = false
  vi.stubGlobal('document', { activeElement: {} })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof observe) {
        observe = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  h.cleanup?.()
  vi.unstubAllGlobals()
})
function RenderVisibility(retainFocus = true) {
  return useNearViewport({ current: element as unknown as HTMLElement }, true, retainFocus)
}
it('unloads offscreen previews even when their control or iframe still has focus', () => {
  RenderVisibility(false)
  observe([{ target: element, isIntersecting: true }])
  expect(h.near).toBe(true)
  observe([{ target: element, isIntersecting: false }])
  expect(h.near).toBe(false)
})
it('preserves the existing editor focus behavior by default', () => {
  RenderVisibility()
  observe([{ target: element, isIntersecting: true }])
  observe([{ target: element, isIntersecting: false }])
  expect(h.near).toBe(true)
})
