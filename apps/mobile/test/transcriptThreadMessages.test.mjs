import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'

test('a report from another thread keeps its sender, so it draws as that thread’s note and not the person’s bubble', () => {
  const from = { kind: 'thread-report', taskId: 't-2', title: 'Ship it', outcome: 'failed', detail: 'Build failed.' }
  const [report, own] = transcript([
    { kind: 'user', text: 'Report from the thread "Ship it": it failed.', at: 1, from },
    { kind: 'user', text: 'Try again', at: 2 },
  ])
  assert.deepEqual(report.from, from)
  assert.equal(own.from, undefined)
})

test('a settings change the agent asked for draws as its card, read from the host by id', () => {
  const [card] = transcript([{ kind: 'settings-change', cardId: 'card-1', at: 1 }])
  assert.equal(card.kind, 'settings-change')
  assert.equal(card.cardId, 'card-1')
})

test('a tool suggestion draws as its card, read from the host by id like the desktop’s', () => {
  const [card] = transcript([{ kind: 'tool-suggestion', cardId: 'card-2', at: 1 }])
  assert.equal(card.kind, 'tool-suggestion')
  assert.equal(card.cardId, 'card-2')
})
