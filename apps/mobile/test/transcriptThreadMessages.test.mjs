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
