import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'
import { endedOnError, foldTurns, formatDuration } from '../src/runtime/turns.ts'

const tool = (id, at, isError = false) => [
  { kind: 'tool-use', toolUseId: id, name: 'Bash', title: `run ${id}`, summary: id, toolKind: 'execute', at },
  { kind: 'tool-result', toolUseId: id, summary: 'ok', isError, at },
]
const finished = [
  { kind: 'user', text: 'go', at: 1_000 },
  { kind: 'text', text: 'looking', at: 2_000 },
  ...tool('a', 3_000),
  { kind: 'text', text: 'done!', at: 65_000 },
  { kind: 'result', isError: false, text: '', costUsd: null, at: 66_000 },
]

test('durations roll over to minutes and hours like the desktop', () => {
  assert.equal(formatDuration(35_000), '35s')
  assert.equal(formatDuration(768_000), '12m 48s')
  assert.equal(formatDuration(3_900_000), '1h 5m')
})

test('a finished turn folds routine steps under "Worked for" and keeps the answer', () => {
  const rows = foldTurns(transcript(finished), false, false)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['user', 'summary', 'text'],
  )
  assert.equal(rows[1].label, 'Worked for 1m 5s')
  assert.deepEqual(
    rows[1].items.map((r) => r.kind),
    ['text', 'tool'],
  )
  assert.equal(rows[2].text, 'done!')
})

test('the running turn is not folded and shows its steps as they come', () => {
  const rows = foldTurns(transcript(finished.slice(0, 3)), true, false)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['user', 'text', 'tool'],
  )
})

test('failed tools stay visible outside the fold, and stopped turns say so', () => {
  const events = [
    { kind: 'user', text: 'go', at: 0 },
    ...tool('a', 1_000),
    ...tool('b', 2_000, true),
    { kind: 'result', isError: true, text: 'interrupted', costUsd: null, at: 5_000 },
  ]
  const rows = foldTurns(transcript(events), false, false)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['user', 'summary', 'tool'],
  )
  assert.equal(rows[1].label, 'Stopped after 5s')
  assert.equal(rows[2].status, 'failed')
})

test('an answer that mentions aborting, or a turn steered into, still reads as worked', () => {
  const answered = [
    ...finished.slice(0, 4),
    {
      kind: 'result',
      isError: false,
      text: 'I added an AbortController so the request can be interrupted.',
      costUsd: null,
      at: 66_000,
    },
  ]
  assert.equal(foldTurns(transcript(answered), false, false)[1].label, 'Worked for 1m 5s')
  const steered = [...finished.slice(0, 3), { kind: 'user', text: 'also add tests', at: 4_000 }, ...finished.slice(3)]
  const rows = foldTurns(transcript(steered), false, false).filter((r) => r.kind === 'summary')
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Worked for 2s'],
  )
  const stopped = [
    ...finished.slice(0, 3),
    { kind: 'result', isError: false, text: 'cancelled', costUsd: null, at: 5_000 },
  ]
  assert.equal(foldTurns(transcript(stopped), false, false)[1].label, 'Stopped after 4s')
})

const goal = (patch = {}) => ({
  id: 'g1',
  objective: 'Login works',
  status: 'active',
  turns: 1,
  reason: '',
  updatedAt: 1,
  ...patch,
})
const goalEvent = (value) => ({ kind: 'goal', goal: value })

test('a failed verification, a stall and the completion evidence get their own lines, apart from limit and pause', () => {
  const failed = {
    command: 'pnpm test',
    ok: false,
    code: 1,
    at: 5,
    output: 'Command exited with code 1.\nFAIL login.test.ts\nexpected 200, got 500',
  }
  const stall = { fingerprint: 'f', unchanged: 2, seq: 3 }
  const items = transcript([
    goalEvent(goal()),
    goalEvent(goal({ check: failed })),
    goalEvent(goal({ status: 'paused', pausedBy: 'provider-limit' })),
    goalEvent(goal({ status: 'paused' })),
    goalEvent(goal({ status: 'blocked', reason: 'No progress: the last 2 continuations changed nothing.', stall })),
    goalEvent(
      goal({
        status: 'completed',
        evidence: { checks: [{ name: 'pnpm test', passed: true }], changedFiles: ['src/login.ts'] },
      }),
    ),
  ])
  const notes = items.filter((item) => item.kind === 'note')
  assert.deepEqual(
    notes.map((n) => [n.goalNote, n.title, n.failed]),
    [
      ['set', 'Goal set', false],
      ['verify-failed', 'Verification failed', true],
      ['paused', 'Goal paused', false],
      ['stalled', 'No progress', true],
    ],
  )
  assert.equal(notes[1].detail, 'pnpm test · Exit 1\nFAIL login.test.ts\nexpected 200, got 500')
  assert.match(notes[3].detail, /^No progress/)
  const done = items.find((item) => item.kind === 'goal')
  assert.equal(done.detail, 'Checks: pnpm test (passed)\nChanged: src/login.ts')
})

test('published interactive content stays visible after provider completion and replay', () => {
  const reference = {
    id: 'content',
    version: 1,
    sessionId: 'session',
    title: 'Capacity',
    summary: 'Explore capacity',
    digest: 'hash',
    createdAt: 1,
    checked: true,
  }
  const events = [
    { kind: 'user', text: 'Show capacity', at: 1 },
    ...tool('preview', 2),
    { kind: 'interactive', reference, at: 3 },
    { kind: 'result', isError: false, text: '', costUsd: null, at: 4 },
  ]
  const rows = foldTurns(transcript(events), false, false)
  assert.equal(rows.at(-1).kind, 'interactive')
  assert.deepEqual(rows.at(-1).reference, reference)
  assert.equal(
    rows.some((r) => r.kind === 'summary' && r.items.some((i) => i.kind === 'interactive')),
    false,
  )
  assert.deepEqual(foldTurns(transcript(structuredClone(events)), false, false), rows)
})

test('helper groups keep launch placement, stopped state, provider metadata and capabilities', () => {
  const events = [
    { kind: 'user', text: 'first' },
    {
      kind: 'agent',
      agentId: 'a',
      name: 'A',
      status: 'stopped',
      provider: 'codex',
      model: 'test',
      canStop: false,
      canMessage: false,
      startedAt: 10,
      endedAt: 20,
    },
    { kind: 'question', requestId: 'q', questions: [], requestSource: { sessionId: 'child', agentId: 'a', name: 'A' } },
    { kind: 'user', text: 'next' },
    { kind: 'agent', agentId: 'advisor', name: 'Advisor', status: 'completed', taskType: 'advisor' },
  ]
  const rows = transcript(events)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['user', 'agents', 'question', 'user', 'agents'],
  )
  assert.equal(rows[1].agents[0].status, 'stopped')
  assert.equal(rows[1].agents[0].provider, 'codex')
  assert.equal(rows[1].agents[0].endedAt, 20)
  assert.equal(rows[1].agents[0].canMessage, false)
  assert.equal(rows[2].requestSource.name, 'A')
  assert.equal(rows[4].advisor, true)
})

test('a provider may reuse an approval id after its previous request was resolved', () => {
  const rows = transcript([
    { kind: 'permission-request', requestId: 'same', title: 'old', detail: 'old command' },
    { kind: 'request-resolved', requestId: 'same', outcome: 'allowed' },
    { kind: 'permission-request', requestId: 'same', title: 'new', detail: 'new command' },
  ])
  assert.equal(rows.at(-1).decision, undefined)
  assert.equal(rows.filter((row) => row.kind === 'permission').length, 1)
})

test('an approval the host can remember offers its rules on the phone, and a saved one can be forgotten', () => {
  const rows = transcript([
    {
      kind: 'permission-request',
      requestId: 'save',
      title: 'Run?',
      detail: 'pnpm test',
      approvalKey: 'k',
      approvalProjectId: 'p1',
      approvalPatterns: ['pnpm test *'],
      approvalReviewRule: 'rm -rf',
    },
    {
      kind: 'permission-request',
      requestId: 'once',
      title: 'Use the screen?',
      detail: 'Computer use',
      approvalKey: 'k2',
      approvalOnceOnly: true,
    },
    { kind: 'permission-request', requestId: 'done', title: 'Run?', detail: 'ls', approvalKey: 'k3' },
    { kind: 'request-resolved', requestId: 'done', outcome: 'allowed-project' },
  ]).filter((row) => row.kind === 'permission')
  assert.deepEqual(
    rows.map((row) => [row.id, row.rememberable, row.patterns, row.reviewRule, row.saved]),
    [
      ['save', { project: true }, ['pnpm test *'], 'rm -rf', undefined],
      // Computer use and other app capabilities ask every time, so nothing is offered to remember.
      ['once', undefined, undefined, undefined, undefined],
      ['done', { project: false }, undefined, undefined, 'project'],
    ],
  )
})

test('mobile groups consecutive tools inside live turns and finished work, preserving each result', () => {
  const events = [
    { kind: 'user', text: 'check', at: 1000 },
    ...tool('first', 2000),
    ...tool('second', 3000),
    { kind: 'text', text: 'Summary', at: 4000 },
  ]
  const live = foldTurns(transcript(events), true, false)
  const group = live.find((row) => row.kind === 'tools')
  assert.deepEqual(
    group.tools.map((entry) => [entry.id, entry.status, entry.detail]),
    [
      ['first', 'completed', 'ok'],
      ['second', 'completed', 'ok'],
    ],
  )
  const finished = foldTurns(
    transcript([...events, { kind: 'result', text: '', isError: false, at: 5000 }]),
    false,
    false,
  )
  assert.equal(finished.find((row) => row.kind === 'summary').items[0].kind, 'tools')
  assert.equal(finished.at(-1).text, 'Summary')
})

test('mobile preserves plan states and keeps unfinished steps visible after the turn', () => {
  const entries = [
    { content: 'Inspect', status: 'completed' },
    { content: 'Fix', status: 'in_progress' },
    { content: 'Verify', status: 'pending' },
  ]
  const items = transcript([
    { kind: 'plan', entries },
    { kind: 'result', text: '', isError: false },
  ])
  assert.deepEqual(items[0].entries, entries)
  assert.equal(foldTurns(items, false, false)[0].kind, 'plan')
})

test('a thread that stopped on an error can continue from it, past its end marker', () => {
  const rows = transcript([
    { kind: 'user', text: 'go', at: 1_000 },
    { kind: 'error', message: 'boom', at: 2_000 },
    { kind: 'result', text: '', isError: true, at: 3_000 },
  ])
  const error = rows.find((row) => row.kind === 'error')
  assert.equal(error.message, 'boom')
  assert.equal(endedOnError(rows, error.id), true)
  const later = transcript([
    { kind: 'error', message: 'boom', at: 1_000 },
    { kind: 'user', text: 'again', at: 2_000 },
  ])
  assert.equal(endedOnError(later, later.find((row) => row.kind === 'error').id), false)
})
