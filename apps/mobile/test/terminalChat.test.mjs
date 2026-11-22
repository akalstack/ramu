import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  captureScreen,
  messageWithTerminal,
  readTerminalDraft,
  terminalDraftKey,
  withScreen,
} from '../src/runtime/terminalChat.ts'
import { visibleMessage } from '../../../packages/shared/src/chat/visibleMessage.ts'
import { sentTerminalAttachments } from '../../../packages/shared/src/chat/terminalContext.ts'

test('takes the rows on screen with their line numbers, and nothing from an empty screen', () => {
  const output = 'one\r\ntwo\r\n\x1b[31mFAIL\x1b[0m a.test.ts\r\n\r\n'
  assert.deepEqual(captureScreen(output, 2, 'Shell 1', 'x'), {
    id: 'x',
    terminal: 'Shell 1',
    lines: [2, 3],
    text: 'two\nFAIL a.test.ts',
  })
  assert.equal(captureScreen('\r\n  \r\n', 10, 'Shell 1'), null)
})

test('keeps one copy of the same capture and reads a broken draft as empty', () => {
  const key = terminalDraftKey('host:chat:t1')
  const first = captureScreen('npm test\r\nFAIL\r\n', 5, 'Shell 1', 'a')
  const drafts = { [key]: withScreen({}, key, first) }
  drafts[key] = withScreen(drafts, key, { ...first, id: 'b' })
  assert.equal(readTerminalDraft(drafts, key).length, 1)
  assert.deepEqual(readTerminalDraft({ [key]: 'not json' }, key), [])
})

test('sends the excerpts as hidden context the transcript leaves out', () => {
  const item = captureScreen('npm test\r\nFAIL\r\n', 5, 'Shell 1', 'a')
  const sent = messageWithTerminal('fix this', [item])
  assert.equal(visibleMessage(sent), 'fix this')
  assert.deepEqual(sentTerminalAttachments(sent), [{ terminal: 'Shell 1', lines: [1, 2], text: 'npm test\nFAIL' }])
  assert.equal(messageWithTerminal('plain', []), 'plain')
})
