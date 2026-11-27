import { expect, it } from 'vitest'
import { gestured, INPUT_SCROLL_MS, newFollowIntent, pressed, scrolled } from '../src/views/agent/lib/followIntent'

it('does not take an upward move nobody made for the reader letting go', () => {
  const intent = newFollowIntent(1000)
  // Rows above fold while a block arrives below: the browser pulls the view up, away from the end.
  scrolled(intent, 940, 200, 5000)
  expect(intent.released).toBe(false)
  // Typing in the message box is not scrolling.
  scrolled(intent, 900, 240, 5000 + INPUT_SCROLL_MS * 10)
  expect(intent.released).toBe(false)
})

it('lets go on a wheel turned up or a touch, and follows again once the reader is back at the end', () => {
  const intent = newFollowIntent(1000)
  gestured(intent, { kind: 'wheel', deltaY: 40 })
  expect(intent.released).toBe(false)
  gestured(intent, { kind: 'wheel', deltaY: -40 })
  expect(intent.released).toBe(true)
  scrolled(intent, 700, 300, 0)
  scrolled(intent, 900, 100, 10)
  expect(intent.released).toBe(true)
  scrolled(intent, 1000, 0, 20)
  expect(intent.released).toBe(false)
  gestured(intent, { kind: 'touch' })
  expect(intent.released).toBe(true)
})

it('lets go when a drag, a click or a key moves the transcript up', () => {
  const drag = newFollowIntent(1000)
  pressed(drag, 0, 'down')
  scrolled(drag, 600, 400, 2000)
  expect(drag.released).toBe(true)

  const click = newFollowIntent(1000)
  pressed(click, 0, 'down')
  pressed(click, 50, 'up')
  scrolled(click, 990, 10, 70)
  expect(click.released).toBe(true)

  const late = newFollowIntent(1000)
  pressed(late, 0)
  scrolled(late, 900, 100, INPUT_SCROLL_MS)
  expect(late.released).toBe(false)
})
