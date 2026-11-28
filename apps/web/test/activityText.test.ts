import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'

type Slot = { current: unknown } | { deps: unknown[]; cleanup?: void | (() => void) }
const state = vi.hoisted(() => ({ cursor: 0, slots: [] as Slot[], effects: [] as (() => void)[] }))
function effect(run: () => void | (() => void), deps: unknown[]) {
  const index = state.cursor++
  const previous = state.slots[index] as Extract<Slot, { deps: unknown[] }> | undefined
  if (!previous || deps.some((dep, at) => dep !== previous.deps[at]))
    state.effects.push(() => {
      previous?.cleanup?.()
      state.slots[index] = { deps, cleanup: run() }
    })
}
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useState: (initial: unknown) => {
    const slot = (state.slots[state.cursor++] ??= {
      current: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    }) as { current: unknown }
    return [slot.current, (value: unknown) => void (slot.current = value)]
  },
  useEffect: effect,
}))
import { ActivityText } from '../src/chat/ActivityText'
import { WorkingText } from '../src/views/agent/components/WorkingText'

const render = (active: boolean, text = 'Read files') => {
  state.cursor = 0
  const tree = ActivityText({ active, children: text })
  state.effects.splice(0).forEach((run) => run())
  return tree
}
beforeEach(() => {
  state.slots = []
  state.effects = []
})
afterEach(() => {
  for (const slot of state.slots) if ('deps' in slot) slot.cleanup?.()
})

it('pulses only once a call has run for a moment, and a finished call is just its label', () => {
  vi.useFakeTimers()
  try {
    render(true)
    render(false)
    vi.advanceTimersByTime(TOOL_MOTION.shimmerDelayMs)
    expect(render(false).props.children).toBe('Read files')
    render(true)
    vi.advanceTimersByTime(TOOL_MOTION.shimmerDelayMs - 1)
    expect(render(true).props.children).toBe('Read files')
    vi.advanceTimersByTime(1)
    expect(render(true).props.children.type).toBe(WorkingText)
    // Done: the label as it is, with nothing sweeping across it.
    expect(render(false, 'Read three files').props.children).toBe('Read three files')
  } finally {
    vi.useRealTimers()
  }
})

it('a working label pulses lighter: a copy in the text color fades in over it, rather than the label dimming', () => {
  state.cursor = 0
  const tree = WorkingText({ children: 'Running tests' })
  const [label, glow] = tree.props.children
  expect(label.props.children).toBe('Running tests')
  expect(glow.props['aria-hidden']).toBe('true')
  expect(glow.props.className).toContain('text-foreground')
  expect(glow.props.className).toContain('opacity-0')
  expect(glow.props.style.animation).toContain('working-glow')
})
