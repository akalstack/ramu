import { expect, it } from 'vitest'
import { HOLD_PAUSE_MS, NO_HOLD, endPause, holdHeight, releaseHold } from '../src/chat/heldHeight'

it('keeps the tallest height a live group reached, so it only grows', () => {
  let hold = holdHeight(NO_HOLD, 40, true, 0)
  hold = holdHeight(hold, 96.2, true, 10)
  expect(hold.min).toBe(97)
  expect(holdHeight(hold, 40, true, 20)).toBe(hold)
  expect(holdHeight(hold, 120, true, 30).min).toBe(120)
})

it('lets go in one step once the group is no longer live', () => {
  const hold = holdHeight(NO_HOLD, 96, true, 0)
  expect(holdHeight(hold, 96, false, 10)).toBe(NO_HOLD)
  expect(holdHeight(NO_HOLD, 40, false, 20)).toBe(NO_HOLD)
})

it('lets a fold by hand show, then holds again from where it settled', () => {
  const tall = holdHeight(NO_HOLD, 300, true, 0)
  const released = releaseHold(1000)
  expect(released.min).toBe(0)
  // Mid-motion heights are not held, so the fold can finish closing.
  expect(holdHeight(released, 200, true, 1000 + HOLD_PAUSE_MS - 1)).toBe(released)
  expect(holdHeight(released, 60, true, 1000 + HOLD_PAUSE_MS)).toEqual({ min: 60, pausedUntil: 0 })
  expect(tall.min).toBe(300)
})

it('picks up when the pause timer fires, even a moment before the clock says the pause is over', () => {
  const released = releaseHold(1000)
  // A timer set for the pause can fire a millisecond early; read as still paused, the hold never came back.
  const early = 1000 + HOLD_PAUSE_MS - 1
  expect(holdHeight(released, 60, true, early)).toBe(released)
  expect(holdHeight(endPause(released), 60, true, early)).toEqual({ min: 60, pausedUntil: 0 })
  expect(endPause(NO_HOLD)).toBe(NO_HOLD)
})

it('gives each group its own hold: A settles when done, B starts from nothing', () => {
  let a = holdHeight(NO_HOLD, 120, true, 0)
  a = holdHeight(a, 60, true, 10)
  expect(a.min).toBe(120)
  expect(holdHeight(a, 60, false, 20)).toBe(NO_HOLD)
  expect(holdHeight(NO_HOLD, 40, true, 30).min).toBe(40)
})
