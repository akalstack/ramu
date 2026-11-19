import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../src/types'
import {
  describeInputCounts,
  inputSummary,
  mergeInputSummaries,
  changesThreadSummary,
  questionChoices,
} from '../src/chat/inputSummary'
import { threadStatus } from '../src/chat/threadStatus'
const approval = (requestId: string): AgentEvent => ({
  kind: 'permission-request',
  requestId,
  title: 'Run tests',
  toolName: 'Bash',
  detail: 'private command arguments',
})
const question: AgentEvent = {
  kind: 'question',
  requestId: 'question',
  questions: [{ question: 'Which branch?', header: '', options: [], multiSelect: false }],
}
it('prioritizes approvals while preserving request identities and forwarded origin', () => {
  const summary = inputSummary(
    [
      question,
      {
        ...approval('forwarded'),
        requestSource: { sessionId: 'child', agentId: 'helper', name: 'Research', requestId: 'native' },
      },
    ],
    'parent',
  )!
  expect(summary).toMatchObject({
    count: 2,
    approvals: 1,
    requests: [
      {
        sessionId: 'parent',
        requestId: 'forwarded',
        kind: 'approval',
        source: { sessionId: 'child', requestId: 'native' },
      },
      { kind: 'question' },
    ],
  })
  expect(JSON.stringify(summary)).not.toContain('private command arguments')
  expect(threadStatus({ status: 'running', inputSummary: summary }, true, { status: 'active' })?.kind).toBe('approval')
})
it('reopens a reused native request ID, resolves the current request, and ignores unforwarded helper events', () => {
  const resolved: AgentEvent = { kind: 'request-resolved', requestId: 'reused', outcome: 'allowed' }
  expect(inputSummary([approval('reused'), resolved], 's')).toBeNull()
  expect(
    inputSummary([approval('reused'), resolved, approval('reused'), { ...resolved, agentId: 'unrelated' }], 's')?.count,
  ).toBe(1)
  expect(inputSummary([{ ...approval('helper'), agentId: 'unrelated' }], 's')).toBeNull()
})
it('bounds excerpts and counts all pending requests when merging sessions', () => {
  const summary = inputSummary(
    Array.from({ length: 8 }, (_, index) => ({ ...approval(String(index)), title: 'a'.repeat(1000) })),
    's',
  )!
  expect(summary.count).toBe(8)
  expect(summary.requests).toHaveLength(3)
  expect(summary.requests[0]!.title).toHaveLength(240)
  expect(mergeInputSummaries([summary, inputSummary([question], 'other')])).toMatchObject({
    count: 9,
    approvals: 8,
    requests: summary.requests,
  })
  expect(mergeInputSummaries([null, undefined])).toBeNull()
})
it('retains older-host generic input and clears resolved summaries without claiming a goal is finished', () => {
  expect(threadStatus({ status: 'needs-input' }, false)?.kind).toBe('input')
  expect(threadStatus({ status: 'idle', inputSummary: inputSummary([question], 's') }, false)?.kind).toBe('input')
  expect(threadStatus({ status: 'idle', inputSummary: null }, true, { status: 'active' })?.kind).toBe('goal')
})

it('refreshes summaries for async input and resolution without refetching on streamed tokens', () => {
  expect(changesThreadSummary(question)).toBe(true)
  expect(changesThreadSummary(approval('a'))).toBe(true)
  expect(changesThreadSummary({ kind: 'request-resolved', requestId: 'a', outcome: 'allowed' })).toBe(true)
  expect(changesThreadSummary({ kind: 'text', text: 'token' })).toBe(false)
})

it('splits pending counts by kind, and leaves non-approvals unclassified for an older host', () => {
  expect(describeInputCounts({ count: 4, approvals: 1, connectors: 1, requests: [] })).toEqual({
    approvals: 1,
    questions: 2,
    connectors: 1,
  })
})

it('records which connector an elicitation is for, bounded, so the Inbox can group sign-ins', () => {
  const summary = inputSummary(
    [
      { kind: 'elicitation', requestId: 'e1', serverName: 'Atlassian', message: 'Sign in', mode: 'url', fields: [] },
      {
        kind: 'elicitation',
        requestId: 'e2',
        serverName: 'x'.repeat(300),
        message: 'Sign in',
        mode: 'url',
        fields: [],
      },
    ],
    'session',
  )
  expect(summary?.connectors).toBe(2)
  expect(summary?.requests[0]?.connector).toBe('Atlassian')
  expect(summary?.requests[1]?.connector).toHaveLength(100)
})

describe('questionChoices', () => {
  const question = (overrides = {}) => ({
    question: 'ISO or locale?',
    header: 'Format',
    multiSelect: false,
    options: [
      { label: 'ISO', description: '' },
      { label: 'Locale', description: '' },
    ],
    ...overrides,
  })

  it('offers buttons only for one single-choice question answered through Ramu', () => {
    expect(questionChoices([question()])).toEqual({ key: 'ISO or locale?', options: ['ISO', 'Locale'] })
    expect(questionChoices([question({ multiSelect: true })])).toBeUndefined()
    expect(questionChoices([question(), question()])).toBeUndefined()
    expect(questionChoices([question()], 'message')).toBeUndefined()
    expect(questionChoices([question({ options: [] })])).toBeUndefined()
  })
})
