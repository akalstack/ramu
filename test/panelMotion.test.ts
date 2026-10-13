import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({ flushSync: (update: () => void) => update() }))

const deferred = () => {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

let animate: typeof import('../src/renderer/src/panelMotion').animatePanelChange
let dataset: Record<string, string>
let transitions: { update: () => void; ready: ReturnType<typeof deferred>; finished: ReturnType<typeof deferred>; skipTransition: ReturnType<typeof vi.fn> }[]
let start: ReturnType<typeof vi.fn>
let frames: FrameRequestCallback[]
let elements: HTMLElement[]

beforeEach(async () => {
  vi.resetModules()
  dataset = {}
  frames = []
  elements = []
  transitions = []
  start = vi.fn((update: () => void) => {
    const ready = deferred(), finished = deferred(), skipTransition = vi.fn()
    transitions.push({ update, ready, finished, skipTransition })
    return { ready: ready.promise, finished: finished.promise, skipTransition }
  })
  vi.stubGlobal('document', { hidden: false, documentElement: { dataset, hasAttribute: (name: string) => name === 'data-reduce-motion' && dataset.reduceMotion !== undefined }, startViewTransition: start, querySelectorAll: () => elements })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  animate = (await import('../src/renderer/src/panelMotion')).animatePanelChange
})
afterEach(() => vi.unstubAllGlobals())

it('applies rapid actions in order exactly once, even when skipped callbacks run later', async () => {
  const changes: string[] = []
  animate(() => changes.push('open'), 'tools')
  animate(() => changes.push('close'), 'workspace')
  expect(changes).toEqual(['open'])
  expect(transitions[0]!.skipTransition).toHaveBeenCalledOnce()
  transitions[0]!.update() // Chromium still invokes the skipped callback.
  transitions[1]!.update()
  expect(changes).toEqual(['open', 'close'])
  transitions[0]!.ready.reject(new Error('Transition skipped'))
  transitions[0]!.finished.resolve()
  await Promise.resolve()
  expect(dataset.panelMotion).toBe('workspace')
  transitions[1]!.ready.resolve()
  transitions[1]!.finished.resolve()
  await Promise.resolve()
  expect(dataset.panelMotion).toBeUndefined()
})

it('batches nested panel changes into one capture', () => {
  const changes: string[] = []
  animate(() => {
    changes.push('editor')
    animate(() => changes.push('terminal'), 'workspace')
  }, 'right')
  transitions[0]!.update()
  expect(changes).toEqual(['editor', 'terminal'])
  expect(start).toHaveBeenCalledOnce()
})

it('updates immediately with reduced motion or without snapshot support', () => {
  const update = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  animate(update, 'tools')
  expect(update).toHaveBeenCalledOnce()
  expect(start).not.toHaveBeenCalled()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('document', { hidden: false, documentElement: { dataset, hasAttribute: (name: string) => name === 'data-reduce-motion' && dataset.reduceMotion !== undefined } })
  animate(update, 'tools')
  expect(update).toHaveBeenCalledTimes(2)
  expect(dataset.panelMotion).toBeUndefined()
})

it('keeps the action working when starting a snapshot throws', () => {
  start.mockImplementation(() => { throw new Error('Capture unavailable') })
  const update = vi.fn()
  animate(update, 'sidebar')
  expect(update).toHaveBeenCalledOnce()
  expect(dataset.panelMotion).toBeUndefined()
})

it('opens immediately and animates only the new live surface without any capture', () => {
  const finished = deferred()
  const animateElement = vi.fn(() => ({ finished: finished.promise, cancel: vi.fn() }))
  const surface = { animate: animateElement } as unknown as HTMLElement
  const existingAnimate = vi.fn()
  const existing = { animate: existingAnimate } as unknown as HTMLElement
  elements = [existing]
  animate(() => { elements = [existing, surface] }, 'workspace', true)
  expect(elements).toEqual([existing, surface])
  expect(start).not.toHaveBeenCalled()
  frames[0]!(0)
  expect(existingAnimate).not.toHaveBeenCalled()
  expect(animateElement).toHaveBeenCalledWith(
    [{ opacity: 0, transform: 'translateX(16px)' }, { opacity: 1, transform: 'translate(0)' }],
    expect.objectContaining({ duration: 180 }),
  )
})

it('switches already open tools without animating their cached surface', () => {
  const animateElement = vi.fn()
  const surface = { animate: animateElement } as unknown as HTMLElement
  elements = [surface]
  const update = vi.fn()
  animate(update, 'tools', true)
  frames[0]!(0)
  expect(update).toHaveBeenCalledOnce()
  expect(animateElement).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})

it('a resize cancels motion but applies a pending panel change exactly once', async () => {
  const { cancelPanelMotion } = await import('../src/renderer/src/panelMotion')
  const update = vi.fn()
  animate(update, 'editor')
  cancelPanelMotion()
  expect(update).toHaveBeenCalledOnce()
  expect(transitions[0]!.skipTransition).toHaveBeenCalledOnce()
  transitions[0]!.update()
  expect(update).toHaveBeenCalledOnce()
})

it('app reduced motion disables panel animation even when the OS allows it', () => {
  dataset.reduceMotion = ''
  const update = vi.fn()
  animate(update, 'chat', true)
  expect(update).toHaveBeenCalledOnce()
  expect(start).not.toHaveBeenCalled()
  expect(frames).toHaveLength(0)
})
