import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeTranscript, transcriptRows } from '../src/runtime/transcriptChanges.ts'

const text = (value) => ({ kind: 'text', text: value })

test('a reset replaces everything held, including rows that no longer exist', () => {
  const held = new Map([
    [1, text('a')],
    [2, text('b')],
  ])
  const next = mergeTranscript(held, { reset: true, cursor: 3, events: [{ seq: 1, event: text('a2') }] })
  assert.deepEqual([...next.keys()], [1])
  assert.equal(next.get(1).text, 'a2')
})

test('changes add new rows and replace edited ones without touching the rest or the held map', () => {
  const held = new Map([
    [1, text('a')],
    [2, text('draft')],
  ])
  const next = mergeTranscript(held, {
    reset: false,
    cursor: 5,
    events: [
      { seq: 2, event: text('final') },
      { seq: 3, event: text('c') },
    ],
  })
  assert.deepEqual(
    transcriptRows(next).map((row) => [row.seq, row.event.text]),
    [
      [1, 'a'],
      [2, 'final'],
      [3, 'c'],
    ],
  )
  assert.equal(held.get(2).text, 'draft', 'the held rows are not mutated')
})

test('changes with nothing held start from the rows given, and an empty change keeps what is held', () => {
  assert.equal(mergeTranscript(undefined, { reset: false, cursor: 1, events: [{ seq: 1, event: text('a') }] }).size, 1)
  const held = new Map([[1, text('a')]])
  assert.equal(mergeTranscript(held, { reset: false, cursor: 1, events: [] }).size, 1)
})

test('rows come out in sequence order whatever order they arrived in', () => {
  const rows = mergeTranscript(undefined, {
    reset: true,
    cursor: 1,
    events: [
      { seq: 3, event: text('c') },
      { seq: 1, event: text('a') },
    ],
  })
  assert.deepEqual(
    transcriptRows(rows).map((row) => row.seq),
    [1, 3],
  )
})
