import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appForeground, finishedAnswerRow, transcriptScrollState } from '../src/runtime/chatViewport.ts'
import { transcript } from '../src/runtime/transcript.ts'

test('jumping to latest stays hidden through intermediate animated scroll offsets', () => {
  for (const gap of [1000, 700, 200, 90, 0])
    assert.deepEqual(transcriptScrollState(true, gap, false, false), { following: true, away: false })
  assert.deepEqual(transcriptScrollState(true, 200, true, false), { following: false, away: true })
  assert.deepEqual(transcriptScrollState(false, 20, true, false), { following: true, away: false })
})

test('keyboard settling does not mistake inset movement for leaving latest', () => {
  assert.deepEqual(transcriptScrollState(true, 200, true, true), { following: true, away: false })
})

test('native interruptions retain foreground state; background and resume change it', () => {
  assert.equal(appForeground(true, 'inactive'), true)
  assert.equal(appForeground(false, 'inactive'), false)
  assert.equal(appForeground(true, 'background'), false)
  assert.equal(appForeground(false, 'active'), true)
})

test('live text is published as a whole block at a subsequent text or tool boundary', () => {
  const first = { kind: 'text', messageId: 'a', text: 'Complete paragraph.' }
  const second = { kind: 'text', messageId: 'b', text: 'Still arriving' }
  assert.equal(transcript([first], [10], true).length, 0)
  const rows = transcript([first, second], [10, 11], true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, first.text)
  assert.equal(rows[0].id, 'event-0')
  const tool = { kind: 'tool-use', toolUseId: 't', name: 'Bash', title: 'Check', summary: '', toolKind: 'execute' }
  assert.equal(transcript([first, second, tool], undefined, true).filter((r) => r.kind === 'text').length, 2)
})

test('final text appears on completion, stop, failure and input requests', () => {
  const text = { kind: 'text', text: 'Final answer', messageId: 'a' }
  for (const state of ['idle', 'stopped', 'failed', 'needs-input'])
    assert.equal(transcript([text, { kind: 'state', state }], undefined, true)[0].text, 'Final answer')
  assert.equal(transcript([text], undefined, false)[0].text, 'Final answer')
})

test('helper activity cannot publish a partial main-agent answer', () => {
  const rows = transcript(
    [
      { kind: 'text', text: 'Partial', messageId: 'a' },
      { kind: 'text', text: 'Helper answer', messageId: 'b', agentId: 'helper' },
      { kind: 'result', text: '', isError: false, agentId: 'helper' },
    ],
    undefined,
    true,
  )
  assert.ok(!rows.some((row) => row.kind === 'text' && row.text === 'Partial'))
})

test('a finished answer taller than the room is read from its first line; one that fits stays at the end', () => {
  const rows = [{ kind: 'user' }, { kind: 'summary' }, { kind: 'text' }, { kind: 'note' }]
  assert.equal(
    finishedAnswerRow(rows, () => 900, 600),
    2,
  )
  assert.equal(
    finishedAnswerRow(rows, () => 400, 600),
    null,
  )
  // A turn that ended without answering the newest message has nothing to read from the top.
  assert.equal(
    finishedAnswerRow([{ kind: 'text' }, { kind: 'user' }, { kind: 'summary' }], () => 900, 600),
    null,
  )
  assert.equal(
    finishedAnswerRow(rows, () => 900, 0),
    null,
    'not measured yet',
  )
})
