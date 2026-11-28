import { expect, it } from 'vitest'
import { transcriptOpening } from '../src/views/agent/lib/transcriptRows'
import { awayFromEnd, gestured, newFollowIntent, scrolled } from '../src/views/agent/lib/followIntent'

const rows = [{ key: 'turn:1' }, { key: 'turn:2' }, { key: 'status:' }]

it('opens a thread at its end unless it was left higher up', () => {
  expect(transcriptOpening(rows, undefined)).toEqual({ end: true })
  expect(transcriptOpening(rows, { stick: true, anchor: { key: 'turn:1', offset: 40 } })).toEqual({ end: true })
  expect(transcriptOpening(rows, { stick: false })).toEqual({ end: true })
})

it('reopens on the row it was left on, scrolled as far past its top', () => {
  expect(transcriptOpening(rows, { stick: false, anchor: { key: 'turn:2', offset: 120 } })).toEqual({
    end: false,
    index: 1,
    viewOffset: -120,
  })
})

it('opens on the earliest drawn turn when the turn it was left on is in an earlier page', () => {
  expect(transcriptOpening(rows, { stick: false, anchor: { key: 'turn:0', offset: 10 } })).toEqual({
    end: false,
    index: 0,
    viewOffset: 0,
  })
  // A message on its way is gone once it lands; it was at the end.
  expect(transcriptOpening(rows, { stick: false, anchor: { key: 'pending-submission:a', offset: 0 } })).toEqual({
    end: true,
  })
})

it('offers the way back to the end only once the reader let go and is away from it', () => {
  const intent = newFollowIntent(1000)
  expect(awayFromEnd(intent, 400)).toBe(false)
  gestured(intent, { kind: 'wheel', deltaY: -40 })
  expect(awayFromEnd(intent, 4)).toBe(false)
  expect(awayFromEnd(intent, 400)).toBe(true)
  scrolled(intent, 1400, 0, 0)
  expect(awayFromEnd(intent, 0)).toBe(false)
})
