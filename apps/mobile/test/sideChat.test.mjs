import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotedQuestion, sideChat } from '../src/runtime/sideChat.ts'

const message = (id, role, at) => ({ id, role, text: id, at })

test('side questions read as one chat in time order and continue the latest aside', () => {
  const chat = sideChat([
    {
      id: 'b',
      sessionId: 's',
      quote: '',
      quoteFrom: 'assistant',
      createdAt: 20,
      messages: [message('b1', 'user', 20)],
    },
    {
      id: 'a',
      sessionId: 's',
      quote: 'a passage',
      quoteFrom: 'assistant',
      createdAt: 10,
      messages: [message('a1', 'user', 10), message('a2', 'assistant', 11)],
    },
  ])
  assert.deepEqual(
    chat.messages.map((m) => [m.id, m.quote]),
    [
      ['a1', 'a passage'],
      ['a2', undefined],
      ['b1', undefined],
    ],
  )
  assert.equal(chat.continueId, 'b')
  assert.equal(chat.waiting, true)
  assert.deepEqual(sideChat([]), { messages: [], continueId: null, waiting: false })
})

test('a passage quoted into an ongoing chat becomes a Markdown quote above the question', () => {
  assert.equal(quotedQuestion('Why?', 'line one\nline two'), '> line one\n> line two\n\nWhy?')
  assert.equal(quotedQuestion('Why?', '  '), 'Why?')
})
