import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectedText } from '../src/runtime/selectedText.ts'

const runs = [{ text: 'Run ' }, { text: 'pnpm test', atom: true }, { text: ' before you ' }, { text: 'push' }]

test('a selection inside plain text copies just those characters', () => {
  assert.equal(selectedText(runs, 0, 3), 'Run')
  assert.equal(selectedText(runs, 13, 17), 'you ')
})

test('an inline code pill or badge copies whole when the selection touches its one placeholder', () => {
  assert.equal(selectedText(runs, 4, 5), 'pnpm test')
  assert.equal(selectedText(runs, 0, 21), 'Run pnpm test before you push')
})

test('an empty or out-of-range selection copies nothing', () => {
  assert.equal(selectedText(runs, 3, 3), '')
  assert.equal(selectedText(runs, 40, 50), '')
})
