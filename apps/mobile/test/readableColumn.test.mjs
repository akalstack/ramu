import { test } from 'node:test'
import assert from 'node:assert/strict'
import { READABLE_WIDTH, readableGutter, withGutter } from '../src/runtime/readableColumn.ts'

test('a phone-width view keeps its full width', () => {
  assert.equal(readableGutter(390), 0)
  assert.equal(readableGutter(READABLE_WIDTH), 0)
  assert.equal(readableGutter(Number.NaN), 0)
})
test('a tablet-width view centers a readable column', () => {
  assert.equal(readableGutter(1024), 132)
  assert.equal(1024 - 2 * readableGutter(1024), READABLE_WIDTH)
  assert.equal(readableGutter(1366, 900), 233)
})
test('the gutter adds to whichever padding the screen already set', () => {
  assert.deepEqual(withGutter({ padding: 16 }, 100), { paddingLeft: 116, paddingRight: 116 })
  assert.deepEqual(withGutter({ padding: 4, paddingHorizontal: 16, paddingLeft: 8 }, 10), {
    paddingLeft: 18,
    paddingRight: 26,
  })
  assert.deepEqual(withGutter(undefined, 20), { paddingLeft: 20, paddingRight: 20 })
  assert.deepEqual(withGutter({ paddingStart: 12 }, 20), { paddingLeft: 32, paddingRight: 20, paddingStart: 32 })
})
