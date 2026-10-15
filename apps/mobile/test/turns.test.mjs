import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'
import { foldTurns, formatDuration } from '../src/runtime/turns.ts'

const tool = (id, at, isError = false) => [
  { kind: 'tool-use', toolUseId: id, name: 'Bash', title: `run ${id}`, summary: id, toolKind: 'execute', at },
  { kind: 'tool-result', toolUseId: id, summary: 'ok', isError, at },
]
const finished = [
  { kind: 'user', text: 'go', at: 1_000 },
  { kind: 'text', text: 'looking', at: 2_000 },
  ...tool('a', 3_000),
  { kind: 'text', text: 'done!', at: 65_000 },
  { kind: 'result', isError: false, text: '', costUsd: null, at: 66_000 },
]

test('durations roll over to minutes and hours like the desktop', () => {
  assert.equal(formatDuration(35_000), '35s')
  assert.equal(formatDuration(768_000), '12m 48s')
  assert.equal(formatDuration(3_900_000), '1h 5m')
})

test('a finished turn folds routine steps under "Worked for" and keeps the answer', () => {
  const rows = foldTurns(transcript(finished), false, false)
  assert.deepEqual(rows.map(r => r.kind), ['user', 'summary', 'text'])
  assert.equal(rows[1].label, 'Worked for 1m 5s')
  assert.deepEqual(rows[1].items.map(r => r.kind), ['text', 'tool'])
  assert.equal(rows[2].text, 'done!')
})

test('the running turn is not folded and shows a live Working rule from the user message', () => {
  const rows = foldTurns(transcript(finished.slice(0, 3)), true, false)
  assert.deepEqual(rows.map(r => r.kind), ['user', 'working', 'text', 'tool'])
  assert.equal(rows[1].since, 1_000)
})

test('failed tools stay visible outside the fold, and stopped turns say so', () => {
  const events = [{ kind: 'user', text: 'go', at: 0 }, ...tool('a', 1_000), ...tool('b', 2_000, true), { kind: 'result', isError: true, text: 'interrupted', costUsd: null, at: 5_000 }]
  const rows = foldTurns(transcript(events), false, false)
  assert.deepEqual(rows.map(r => r.kind), ['user', 'summary', 'tool'])
  assert.equal(rows[1].label, 'Stopped after 5s')
  assert.equal(rows[2].status, 'failed')
})
