import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'

type Slot = { current: unknown } | { deps: unknown[]; cleanup?: void | (() => void) }
const state = vi.hoisted(() => ({ cursor: 0, slots: [] as Slot[], effects: [] as (() => void)[], reduced: false }))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (initial: unknown) => (state.slots[state.cursor++] ??= { current: initial }),
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = state.cursor++
    const previous = state.slots[index] as Extract<Slot, { deps: unknown[] }> | undefined
    if (!previous || deps.some((dep, at) => dep !== previous.deps[at]))
      state.effects.push(() => {
        previous?.cleanup?.()
        state.slots[index] = { deps, cleanup: effect() }
      })
  },
}))
vi.mock('../src/workspace/panelMotion', () => ({ reducedMotion: () => state.reduced }))
import { ActivityText } from '../src/chat/ActivityText'
const cancel = vi.fn()
const animate = vi.fn((_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel }))
const render = (active: boolean, text = 'Read files') => {
  state.cursor = 0
  const tree = ActivityText({ active, children: text })
  tree.props.children[1].props.ref.current = { animate }
  state.effects.splice(0).forEach((effect) => effect())
  return tree
}
let now = 0
beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  state.slots = []
  state.effects = []
  state.reduced = false
  animate.mockClear()
  cancel.mockClear()
})
afterEach(() => {
  for (const slot of state.slots) if ('deps' in slot) slot.cleanup?.()
})
it('keeps completed history still and sweeps once only after a live step settles', () => {
  render(false)
  expect(animate).not.toHaveBeenCalled()
  render(true)
  render(true, 'Reading more files')
  expect(animate).not.toHaveBeenCalled()
  now = TOOL_MOTION.quietMs
  const tree = render(false, 'Read files')
  expect(tree.props.children[0].props.children).toBe('Read files')
  expect(tree.props.children[1].props['aria-hidden']).toBe('true')
  expect(animate).toHaveBeenCalledTimes(1)
  expect(animate.mock.calls[0]?.[1]).toMatchObject({ delay: TOOL_MOTION.settleMs, duration: TOOL_MOTION.finishMs })
  expect(animate.mock.calls[0]?.[0][0]).toMatchObject({ clipPath: 'inset(0 100% 0 0)' })
  render(false, 'Read three files')
  expect(animate).toHaveBeenCalledTimes(1)
  render(true)
  expect(cancel).toHaveBeenCalledTimes(1)
})
it('does not light up a row that has only just appeared, as when its group opens', () => {
  render(true)
  now = TOOL_MOTION.quietMs - 1
  render(false)
  expect(animate).not.toHaveBeenCalled()
})
it('shows the completed label immediately with reduced motion and no decorative animation', () => {
  state.reduced = true
  render(true)
  const tree = render(false, 'Completed')
  expect(tree.props.children[0].props.children).toBe('Completed')
  expect(animate).not.toHaveBeenCalled()
})
