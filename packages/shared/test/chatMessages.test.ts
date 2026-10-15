import { describe, expect, it } from 'vitest'
import { answerMessage, parseAnswerMessage } from '../src/questions'
import { parseTaskStop, taskStopPrompt } from '../src/agentTasks'

// Messages Ramu sends on the user's behalf: the agent reads the full text, the chat shows only what the user did.
describe('chat messages Ramu writes for the user', () => {
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
    expect(parseAnswerMessage('Answer to your earlier question, please')).toBeNull()
  })
  it('shows a Codex sub-agent stop request as a note', () => {
    expect(
      parseTaskStop(taskStopPrompt({ agentId: 'a1', address: 'thread-9', name: 'Explorer "one"', status: 'running' })),
    ).toEqual({ name: "Explorer 'one'" })
    expect(parseTaskStop('Stop the build')).toBeNull()
  })
})
