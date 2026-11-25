import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'
import { foldTurns } from '../src/runtime/turns.ts'
import { learningCounts, learningLineText, undoneText, withLearningLines } from '../src/runtime/learningLines.ts'

const say = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
const job = (id, seq, extra = {}) => ({
  id,
  sessionId: 's',
  projectId: null,
  seq,
  status: 'applied',
  createdAt: seq,
  error: null,
  proposal: null,
  changes: { memories: [{ id: 'm', title: 'Note', action: 'added', updatedAt: 1 }], skills: [] },
  ...extra,
})

test('counts name only what a review touches, with singular and plural', () => {
  assert.equal(learningCounts({ notes: 2, newSkills: 1, updatedSkills: 0 }, say), '2 notes · 1 new skill')
  assert.equal(learningCounts({ notes: 1, newSkills: 0, updatedSkills: 3 }, say), '1 note · 3 updated skills')
})

test('each review state reads as one line', () => {
  const saved = { notes: 1, newSkills: 0, updatedSkills: 0 }
  const waiting = { notes: 0, newSkills: 1, updatedSkills: 0 }
  const none = { notes: 0, newSkills: 0, updatedSkills: 0 }
  assert.equal(learningLineText({ state: 'saved', saved, waiting: none }, say), 'Learned 1 note')
  assert.equal(learningLineText({ state: 'proposed', saved: none, waiting }, say), 'Ramu can save 1 new skill')
  assert.equal(learningLineText({ state: 'undone', saved, waiting: none }, say), 'Learning undone')
})

test('Undo says how many items it left because they changed since', () => {
  assert.equal(undoneText(0, say), 'Undone')
  assert.equal(undoneText(1, say), 'Undone. 1 item changed since, so it was kept.')
  assert.equal(undoneText(2, say), 'Undone. 2 items changed since, so they were kept.')
})

test('a review sits under the turn it learned from, before the next message', () => {
  const events = [
    { kind: 'user', text: 'one', at: 1 },
    { kind: 'text', text: 'first', at: 2 },
    { kind: 'result', isError: false, text: '', costUsd: null, at: 3 },
    { kind: 'user', text: 'two', at: 4 },
    { kind: 'text', text: 'second', at: 5 },
    { kind: 'result', isError: false, text: '', costUsd: null, at: 6 },
  ]
  const rows = foldTurns(transcript(events, [1, 2, 3, 4, 5, 6]), false, false)
  const placed = withLearningLines(rows, [job('b', 6), job('a', 3), job('other', 3, { sessionId: 'x' })], 's')
  assert.deepEqual(
    placed.map((row) => (row.kind === 'learning' ? row.id : row.kind)),
    ['user', 'text', 'learning-a', 'user', 'text', 'learning-b'],
  )
})

test('reviews with nothing to show, such as a running one, add no line', () => {
  const rows = foldTurns(transcript([{ kind: 'user', text: 'one', at: 1 }], [1]), false, false)
  assert.equal(withLearningLines(rows, [job('r', 2, { status: 'running', changes: undefined })], 's'), rows)
})
