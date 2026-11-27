import { describe, expect, it } from 'vitest'
import { answerChoices, answerMessage, answerPairs, parseAnswerMessage } from '../src/chat/questions'
import { parseTaskStop, taskStopPrompt } from '../src/chat/agentTasks'

// Messages Ramu sends on the user's behalf: the agent reads the full text, the chat shows only what the user did.
describe('thread messages Ramu writes for the user', () => {
  it('shows late answers without the delivery note', () => {
    const text = answerMessage('req-1', [
      { question: 'Which database?', answer: 'SQLite' },
      { question: 'Which region?', answer: 'Jakarta' },
    ])
    expect(text).toMatch(/^Answer to your earlier questions \(request req-1\)\./)
    expect(parseAnswerMessage(text)).toEqual({
      requestId: 'req-1',
      body: 'Which database?\nSQLite\n\nWhich region?\nJakarta',
    })
    expect(parseAnswerMessage(answerMessage('req-2', [{ question: 'Q', answer: 'A' }]))?.body).toBe('Q\nA')
    // The context Ramu appends for the agent is no part of the answer.
    expect(
      parseAnswerMessage(
        `${answerMessage('req-3', [{ question: 'Q', answer: 'A' }])}\n\n<ramu-context>\nThis project's repositories are exactly: ramu\n</ramu-context>`,
      )?.body,
    ).toBe('Q\nA')
    expect(parseAnswerMessage('Answer to your earlier question, please')).toBeNull()
  })
  it('sets each late answer apart from the question it answers', () => {
    expect(answerPairs('Which database?\nSQLite\n\nWhich region?\nJakarta\nor Singapore')).toEqual([
      { question: 'Which database?', answer: 'SQLite' },
      { question: 'Which region?', answer: 'Jakarta\nor Singapore' },
    ])
    expect(answerPairs('Why?\nFirst reason\n\nSecond reason')).toEqual([
      { question: 'Why?', answer: 'First reason\n\nSecond reason' },
    ])
  })
  it('shows a Codex sub-agent stop request as a note', () => {
    expect(
      parseTaskStop(taskStopPrompt({ agentId: 'a1', address: 'thread-9', name: 'Explorer "one"', status: 'running' })),
    ).toEqual({ name: "Explorer 'one'" })
    expect(parseTaskStop('Stop the build')).toBeNull()
  })
})

describe('answerChoices', () => {
  const options = ['Home, new thread', 'Open thread', 'Desktop'].map((label) => ({ label, description: '' }))
  it('marks the picked choices and keeps what the person typed apart', () => {
    expect(answerChoices({ options, multiSelect: false }, 'Open thread')).toEqual({
      options: [
        { label: 'Home, new thread', chosen: false },
        { label: 'Open thread', chosen: true },
        { label: 'Desktop', chosen: false },
      ],
      typed: '',
    })
    const several = answerChoices({ options, multiSelect: true }, 'Home, new thread, Desktop')!
    expect(several.options.map((option) => option.chosen)).toEqual([true, false, true])
    expect(several.typed).toBe('')
    expect(answerChoices({ options, multiSelect: false }, 'Something else')!.typed).toBe('Something else')
    expect(answerChoices({ options: [], multiSelect: false }, 'Free text')).toBeNull()
  })
})
