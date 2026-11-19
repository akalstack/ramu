import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CHAT_MOTION, SENT_MOTION } from '@ramu/shared/chat/presentation'
import type { ReactElement } from 'react'

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
import { ChatFade, ChatStatus, useSentRise } from '../src/chat/ChatMotion'
const cancel = vi.fn()
const animate = vi.fn(() => ({ cancel }))
const render = (identity: string, enter = true, text = identity) => {
  state.cursor = 0
  const tree = ChatFade({ identity, animate: enter, children: text })
  tree.props.ref.current = { animate }
  state.effects.splice(0).forEach((effect) => effect())
  return tree
}
beforeEach(() => {
  state.slots = []
  state.effects = []
  state.reduced = false
  animate.mockClear()
  cancel.mockClear()
})
afterEach(() => {
  for (const slot of state.slots) if ('deps' in slot) slot.cleanup?.()
})

it('fades each status phase with the shared timing and keeps streaming and timer updates stationary', () => {
  render('Starting…')
  expect(animate).toHaveBeenCalledTimes(1)
  render('Working')
  expect(animate).toHaveBeenCalledTimes(2)
  render('Working', true, 'Working for 2s')
  expect(animate).toHaveBeenCalledTimes(2)
  render('Writing…')
  expect(animate).toHaveBeenCalledTimes(3)
  expect(animate.mock.calls[0]).toEqual([
    [
      { opacity: 0, transform: `translateY(${CHAT_MOTION.rise}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: CHAT_MOTION.durationMs, easing: `cubic-bezier(${CHAT_MOTION.easing.join(', ')})` },
  ])
  expect(cancel).toHaveBeenCalledTimes(2)
})

it('reveals existing tool summaries immediately and fades only subsequent state changes', () => {
  render('Running', false)
  expect(animate).not.toHaveBeenCalled()
  render('Completed', false)
  expect(animate).toHaveBeenCalledTimes(1)
})

it('respects both reduced-motion preferences through the shared desktop check', () => {
  state.reduced = true
  render('Starting…')
  render('Working')
  expect(animate).not.toHaveBeenCalled()
})

it('keeps a stable polite live region around changing status text', () => {
  const before = ChatStatus({ label: 'Starting…' })
  const after = ChatStatus({ label: 'Working', compacting: true })
  expect(before.type).toBe(after.type)
  expect(after.props.role).toBe('status')
  expect(after.props['aria-live']).toBe('polite')
  expect((after.props.children as ReactElement<{ identity: string }>).props.identity).toBe('Working')
})

const useMountedSent = (start: boolean, at: number) => {
  state.cursor = 0
  state.slots = []
  vi.spyOn(performance, 'now').mockReturnValue(at)
  const animation = { cancel, currentTime: 0 as number | null }
  const sentAnimate = vi.fn(() => animation)
  useSentRise(start).current = { animate: sentAnimate } as unknown as HTMLElement
  state.effects.splice(0).forEach((effect) => effect())
  return { sentAnimate, animation }
}

it('lets a sent message rise from the composer and has the host copy finish the same rise', () => {
  const sent = useMountedSent(true, 1000)
  expect(sent.sentAnimate).toHaveBeenCalledTimes(1)
  expect(sent.sentAnimate.mock.calls[0]).toEqual([
    [
      { opacity: 0, transform: `translateY(${SENT_MOTION.rise}px) scale(${SENT_MOTION.scale})` },
      { opacity: 1, offset: SENT_MOTION.opaqueAt },
      { opacity: 1, transform: 'none' },
    ],
    { duration: SENT_MOTION.durationMs, easing: `cubic-bezier(${SENT_MOTION.easing.join(', ')})` },
  ])
  expect(sent.animation.currentTime).toBe(0)
  const host = useMountedSent(false, 1120)
  expect(host.sentAnimate).toHaveBeenCalledTimes(1)
  expect(host.animation.currentTime).toBe(120)
  // Messages that appear later, such as older turns, stay where they are.
  expect(useMountedSent(false, 1000 + SENT_MOTION.durationMs).sentAnimate).not.toHaveBeenCalled()
})

it('does not move a sent message when motion is reduced', () => {
  state.reduced = true
  expect(useMountedSent(true, 5000).sentAnimate).not.toHaveBeenCalled()
  expect(useMountedSent(false, 5010).sentAnimate).not.toHaveBeenCalled()
})
