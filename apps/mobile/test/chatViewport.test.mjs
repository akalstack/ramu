import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appForeground } from '../src/runtime/chatViewport.ts'
import { transcript } from '../src/runtime/transcript.ts'

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

