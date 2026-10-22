import { expect, it } from 'vitest'
import type { AgentEvent } from '../src/types'
import { describeInputCounts, inputSummary, mergeInputSummaries, changesThreadSummary } from '../src/chat/inputSummary'
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
    other: 0,
  })
  expect(describeInputCounts({ count: 3, approvals: 1, requests: [] })).toEqual({
    approvals: 1,
    questions: 0,
    connectors: 0,
    other: 2,
  })
  const old = { count: 1, approvals: 0, requests: [] }
  expect(
    mergeInputSummaries([old, { count: 1, approvals: 0, connectors: 1, requests: [] }])?.connectors,
  ).toBeUndefined()
})
