import { expect, it } from 'vitest'
import { needsOwnCheckout } from '../src/agent/helperCheckout'

const helper = { background: false, readOnly: false, teammate: false, otherWriters: 0 }

it('shares the checkout with a helper the thread waits for alone', () => {
  expect(needsOwnCheckout(helper)).toBe(false)
})

it('gives a copy to a helper that writes beside other work', () => {
  expect(needsOwnCheckout({ ...helper, background: true })).toBe(true)
  expect(needsOwnCheckout({ ...helper, otherWriters: 1 })).toBe(true)
})

it('never copies for a read-only helper or a teammate', () => {
  expect(needsOwnCheckout({ ...helper, background: true, readOnly: true })).toBe(false)
  expect(needsOwnCheckout({ ...helper, otherWriters: 2, teammate: true })).toBe(false)
})
