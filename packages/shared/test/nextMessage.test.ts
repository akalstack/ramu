import { describe, expect, it } from 'vitest'
import { nextMessagePoint, nextMessagePrompt, parseNextMessages } from '../src/chat/nextMessage'
import type { AgentEvent } from '../src/types'

const user: AgentEvent = { kind: 'user', text: 'Add a dark theme' }
const done: AgentEvent = { kind: 'result', isError: false, text: 'Added it.', costUsd: null }

describe('nextMessagePoint', () => {
  it('is the clean end of the last turn, while the agent is idle', () => {
    expect(nextMessagePoint([user, done], 'idle')).toEqual({ at: 1 })
    expect(nextMessagePoint([user, done], 'running')).toBeNull()
    expect(nextMessagePoint([user], 'idle')).toBeNull()
  })

  it('stays quiet after a failed or stopped turn, with a message queued, or with a question open', () => {
    expect(nextMessagePoint([user, { ...done, isError: true }], 'idle')).toBeNull()
    expect(nextMessagePoint([user, { ...done, text: 'interrupted' }], 'idle')).toBeNull()
    expect(nextMessagePoint([user, done, { kind: 'error', message: 'Limit reached' }], 'idle')).toBeNull()
    const queued: AgentEvent = { kind: 'queue', messages: [{ id: 'q', text: 'next', mode: 'queue' }] }
    expect(nextMessagePoint([user, done, queued], 'idle')).toBeNull()
    expect(nextMessagePoint([user, done, queued, { kind: 'queue', messages: [] }], 'idle')).toEqual({ at: 1 })
    const question: AgentEvent = {
      kind: 'question',
      requestId: 'r',
      responseMode: 'message',
      questions: [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [] }],
    }
    expect(nextMessagePoint([user, question, done], 'idle')).toBeNull()
    expect(
      nextMessagePoint(
        [user, question, done, { kind: 'request-resolved', requestId: 'r', outcome: 'answered' }],
        'idle',
      ),
    ).toEqual({ at: 2 })
  })

  it('ignores a helper’s own results', () => {
    expect(nextMessagePoint([user, { ...done, agentId: 'helper' }], 'idle')).toBeNull()
  })
})

describe('parseNextMessages', () => {
  it('keeps up to three distinct single-line messages, the most likely first', () => {
    const reply =
      'Here you go:\n{"suggestions": ["Run the tests", "run the tests", "Commit\\nthis", "Open a pull request", "Ship it"]}'
    expect(parseNextMessages(reply)).toEqual(['Run the tests', 'Commit this', 'Open a pull request'])
  })

  it('gives none for an empty list, prose, or anything unreadable', () => {
    expect(parseNextMessages('{"suggestions": []}')).toEqual([])
    expect(parseNextMessages('I would suggest running the tests.')).toEqual([])
    expect(parseNextMessages('{"suggestions": "Run the tests"}')).toEqual([])
    expect(parseNextMessages(`{"suggestions": ["${'x'.repeat(200)}", 4]}`)).toEqual([])
  })
})

describe('nextMessagePrompt', () => {
  it('tells the model what Ramu knows about the thread', () => {
    const prompt = nextMessagePrompt({ goal: 'Ship the dark theme', uncommittedFiles: 3 })
    expect(prompt).toContain('Ship the dark theme')
    expect(prompt).toContain('3 file(s)')
    expect(nextMessagePrompt({})).not.toContain('What is known')
  })
})
