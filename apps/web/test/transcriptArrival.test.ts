import { expect, it } from 'vitest'
import { transcriptArrivals } from '../src/views/agent/lib/transcriptArrival'

it('reveals cached history immediately and claims each new block only once', () => {
  const arrivals = transcriptArrivals()
  arrivals.sync([1, 2, 3], false)
  expect(arrivals.claim(2)).toBe(false)
  expect(arrivals.claim(4)).toBe(true)
  // Streaming replaces the event object but retains its sequence; folding can remount it.
  expect(arrivals.claim(4)).toBe(false)
  arrivals.sync([1, 2, 3, 4, 5], false)
  expect(arrivals.claim(5)).toBe(true)
})

it('waits for hydration and never animates loaded or paginated history', () => {
  const arrivals = transcriptArrivals()
  arrivals.sync([], true)
  expect(arrivals.claim(1)).toBe(false)
  arrivals.sync([1, 2], true)
  arrivals.sync([1, 2, 3], false)
  expect(arrivals.claim(1)).toBe(false)
  expect(arrivals.claim(3)).toBe(false)
  expect(arrivals.claim(4)).toBe(true)
  expect(arrivals.claim(undefined)).toBe(false)
})

it('tells a row that arrived while the chat was open from loaded history, as often as asked', () => {
  const arrivals = transcriptArrivals()
  arrivals.sync([1, 2], true)
  expect(arrivals.fresh(3)).toBe(false)
  arrivals.sync([1, 2], false)
  expect(arrivals.fresh(2)).toBe(false)
  expect(arrivals.fresh(3)).toBe(true)
  expect(arrivals.claim(3)).toBe(true)
  expect(arrivals.fresh(3)).toBe(true)
  expect(arrivals.fresh(undefined)).toBe(false)
})
