import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrollBusy } from '../src/runtime/scrollBusy.ts'

test('holds updates while a scroll is under way, and only for a bounded time', () => {
  scrollBusy.set(false, 0)
  assert.equal(scrollBusy.holds(1200, 10), false)
  scrollBusy.set(true, 1000)
  assert.equal(scrollBusy.holds(1200, 1500), true)
  // Still scrolling: the same scroll, so its clock is not restarted.
  scrollBusy.set(true, 1800)
  assert.equal(scrollBusy.holds(1200, 2100), true)
  assert.equal(scrollBusy.holds(1200, 2300), false)
  scrollBusy.set(false, 2400)
  assert.equal(scrollBusy.holds(1200, 2401), false)
  // The next scroll starts its own time.
  scrollBusy.set(true, 5000)
  assert.equal(scrollBusy.holds(1200, 5100), true)
  scrollBusy.set(false, 5200)
})
