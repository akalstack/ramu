import { test } from 'node:test'
import assert from 'node:assert/strict'
import { revealsComputer } from '../src/runtime/floatPreview.ts'

test('the computer preview floats when the agent starts, never for what was already on screen', () => {
  assert.equal(revealsComputer(null, { present: true, agent: true }), false)
  assert.equal(revealsComputer({ present: false, agent: false }, { present: true, agent: false }), true)
  assert.equal(revealsComputer({ present: true, agent: false }, { present: true, agent: true }), true)
  assert.equal(revealsComputer({ present: true, agent: true }, { present: true, agent: true }), false)
  assert.equal(revealsComputer({ present: true, agent: true }, { present: true, agent: false }), false)
  assert.equal(revealsComputer({ present: true, agent: true }, { present: false, agent: false }), false)
})
