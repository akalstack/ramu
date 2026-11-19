import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'
import { foldTurns } from '../src/runtime/turns.ts'

test('reasoning becomes its own row and an empty text block draws nothing', () => {
  const items = transcript([
    { kind: 'user', text: 'Why?', at: 1 },
    { kind: 'thinking', text: 'Looking at the cause.' },
    { kind: 'text', text: '' },
    { kind: 'text', text: 'Because.' },
  ])
  assert.deepEqual(
    items.map((item) => item.kind),
    ['user', 'thinking', 'text'],
  )
})

test('a finished turn folds its reasoning into Worked for, keeping the answer', () => {
  const items = transcript([
    { kind: 'user', text: 'Why?', at: 1000 },
    { kind: 'thinking', text: 'Looking at the cause.' },
    { kind: 'text', text: 'Because.' },
    { kind: 'result', isError: false, text: 'Because.', at: 4000 },
  ])
  const folded = foldTurns(items, false, false)
  assert.deepEqual(
    folded.map((item) => item.kind),
    ['user', 'summary', 'text'],
  )
})
