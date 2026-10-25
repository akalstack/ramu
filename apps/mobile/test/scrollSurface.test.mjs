import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pastScrollEdge } from '../src/runtime/scrollSurface.ts'

test('header background changes only after leaving the actual resting inset', () => {
  for (const inset of [0, 44, 103]) {
    assert.equal(pastScrollEdge(-inset, inset), false)
    assert.equal(pastScrollEdge(-inset - 50, inset), false)
    assert.equal(pastScrollEdge(-inset + 9, inset), true)
    assert.equal(pastScrollEdge(-inset, inset), false)
  }
})
