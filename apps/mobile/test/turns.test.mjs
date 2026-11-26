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

test('a message on its way does not make the finished turn above read as resumed', () => {
  // The thread is busy for the next message before the host has echoed it.
  const resumed = foldTurns(transcript(finished), true, false)
  assert.equal(resumed[1].running?.text, 'Working for {0}')
  const sent = foldTurns(transcript(finished), true, false, undefined, [], true)
  assert.equal(sent[1].label, 'Worked for 1m 5s')
  assert.equal(sent[1].running, undefined)
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
  // Each note names its goal for the activity row; only a failure or a stall adds a detail beneath it.
  assert.ok(notes.every((note) => note.objective === goal().objective))
  assert.equal(notes[0].detail, undefined)
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

test('mobile keeps every thought beside tools in their group, the one still streaming too', () => {
  const events = [
    { kind: 'user', text: 'ship', at: 1000 },
    { kind: 'thinking', text: 'look first', at: 1500 },
    ...tool('first', 2000),
    { kind: 'thinking', text: 'then deploy', at: 2500 },
    ...tool('second', 3000),
    { kind: 'thinking', text: 'checking', at: 3500 },
  ]
  const live = foldTurns(transcript(events), true, false)
  const group = live.find((row) => row.kind === 'tools')
  assert.deepEqual(
    group.entries.map((entry) => entry.kind),
    ['thinking', 'tool', 'thinking', 'tool', 'thinking'],
  )
  assert.deepEqual(
    group.tools.map((entry) => entry.id),
    ['first', 'second'],
  )
  assert.equal(live.at(-1), group)
  // Reasoning with no tool beside it has no group to join.
  const alone = foldTurns(
    transcript([
      { kind: 'user', text: 'hi', at: 1 },
      { kind: 'thinking', text: 'hm', at: 2 },
    ]),
    true,
    false,
  )
  assert.equal(alone.at(-1).kind, 'thinking')
  const finished = foldTurns(
    transcript([
      ...events,
      { kind: 'text', text: 'Live', at: 4000 },
      { kind: 'result', text: '', isError: false, at: 5000 },
    ]),
    false,
    false,
  )
  const summary = finished.find((row) => row.kind === 'summary')
  assert.deepEqual(
    summary.items.map((row) => row.kind),
    ['tools'],
  )
  assert.equal(summary.items[0].entries.length, 5)
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

test("the agent's background commands are processes, so the phone lists them with background terminals, not agents", async () => {
  const { mobileThreadActivity, providerCommands } = await import('../src/runtime/threadActivity.ts')
  const command = { agentId: 'bash-1', name: 'pnpm dev', status: 'running', taskType: 'local_bash', background: true }
  const chat = { items: [], queue: [], status: 'idle', commands: [command] }
  const activity = mobileThreadActivity(chat, true)
  assert.deepEqual(activity.helpers, [])
  assert.equal(activity.model.counts.active, 0)
  assert.deepEqual(
    providerCommands(chat).map((task) => [task.id, task.type]),
    [['bash-1', 'local_bash']],
  )
})

test('work after a finished turn opens a running turn instead of folding into the finished one', () => {
  const events = [
    ...finished,
    { kind: 'thinking', text: 'Resuming the goal', at: 70_000 },
    { kind: 'text', text: 'Building the hero next.', at: 71_000 },
  ]
  const rows = foldTurns(transcript(events), true, false)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['user', 'summary', 'text', 'thinking', 'text'],
  )
  assert.equal(rows[1].label, 'Worked for 1m 5s')
  assert.equal(rows.at(-1).text, 'Building the hero next.')
})

test('a goal note stays where it happened instead of trailing every new step', () => {
  const goal = { kind: 'note', id: 'goal-set', title: 'Goal set', goalNote: 'set', objective: 'Ship it' }
  const items = transcript([...finished.slice(0, 2), ...tool('a', 3_000), ...tool('b', 4_000)])
  // Set between the two tools, as the agent did it.
  const at = items.findIndex((item) => item.kind === 'tool') + 1
  const withGoal = [...items.slice(0, at), goal, ...items.slice(at)]
  const kinds = (rows) => rows.map((row) => (row.kind === 'note' ? row.id : row.kind))
  assert.deepEqual(kinds(foldTurns(withGoal, true, false)), ['user', 'text', 'tool', 'goal-set', 'tool'])
  // Finished, it stays above the answer with what was not folded; a note after the last step still closes the turn.
  const stop = { kind: 'note', id: 'stopped', title: 'Stopped' }
  const done = [...withGoal, ...transcript([{ kind: 'text', text: 'done!', at: 65_000 }]), stop]
  assert.deepEqual(kinds(foldTurns(done, false, false)), ['user', 'summary', 'goal-set', 'text', 'stopped'])
})

test('a steered message stays in its turn: one "Worked for" for the whole turn and "Continued for" after the steer', () => {
  const rows = foldTurns(
    transcript([
      { kind: 'user', text: 'go', at: 1_000 },
      ...tool('a', 2_000),
      { kind: 'user', text: 'also add tests', steered: true, at: 10_000 },
      ...tool('b', 20_000),
      { kind: 'text', text: 'done!', at: 40_000 },
      { kind: 'result', isError: false, text: '', costUsd: null, at: 41_000 },
    ]),
    false,
    false,
  )
  assert.deepEqual(
    rows.map((r) => (r.kind === 'user' ? `user:${r.text}` : r.kind)),
    ['user:go', 'summary', 'user:also add tests', 'summary', 'text'],
  )
  assert.equal(rows[1].label, 'Worked for 40s')
  assert.equal(rows[3].label, 'Continued for 31s')
})

test('a message steered in too late for its turn heads the work done for it', () => {
  const rows = foldTurns(
    transcript([
      { kind: 'user', text: 'where do things stand?', at: 1_000 },
      { kind: 'user', text: 'fix the header', steered: true, at: 2_000 },
      { kind: 'text', text: 'Everything is in place.', at: 3_000 },
      { kind: 'result', isError: false, text: '', costUsd: null, at: 4_000 },
      ...tool('a', 5_000),
      { kind: 'text', text: 'Fixed.', at: 9_000 },
      { kind: 'result', isError: false, text: '', costUsd: null, at: 10_000 },
    ]),
    false,
    false,
  )
  assert.deepEqual(
    rows.map((r) => (r.kind === 'user' || r.kind === 'text' ? `${r.kind}:${r.text}` : r.kind)),
    ['user:where do things stand?', 'text:Everything is in place.', 'user:fix the header', 'summary', 'text:Fixed.'],
  )
})

test('the same error or notice back to back reads once with its count, as on the desktop', () => {
  const items = transcript([
    { kind: 'user', text: 'go', at: 1_000 },
    { kind: 'error', message: 'Overloaded', at: 2_000 },
    { kind: 'state', state: 'failed', at: 2_100 },
    { kind: 'error', message: 'Overloaded', at: 3_000 },
    { kind: 'error', message: 'Overloaded', at: 4_000 },
    { kind: 'recovery', state: 'resumed', at: 5_000 },
    { kind: 'recovery', state: 'resumed', at: 6_000 },
    { kind: 'error', message: 'Overloaded', at: 7_000 },
  ])
  const shown = items.filter((item) => item.kind !== 'end')
  assert.deepEqual(
    shown.map((item) => [item.kind, item.at, item.repeats ?? 1]),
    [
      ['user', 1_000, 1],
      ['error', 2_000, 3],
      ['note', 5_000, 2],
      ['error', 7_000, 1],
    ],
  )
  // The first keeps its id, so the row on screen and its place in the list stay put.
  assert.equal(shown[1].id, 'event-1')
})

test('goal notes with no work between read as their net change', () => {
  const goal = (patch = {}) => ({
    id: 'g',
    objective: 'Ship it',
    status: 'active',
    turns: 0,
    reason: '',
    updatedAt: 1,
    ...patch,
  })
  const notes = transcript([
    { kind: 'user', text: 'go', at: 1_000 },
    { kind: 'goal', goal: goal() },
    { kind: 'goal', goal: goal({ objective: 'Ship it today' }) },
    { kind: 'text', text: 'on it', at: 2_000 },
    { kind: 'goal', goal: goal({ objective: 'Ship it today', status: 'paused' }) },
    { kind: 'goal', goal: goal({ objective: 'Ship it today', status: 'active' }) },
  ]).filter((item) => item.kind === 'note')
  assert.deepEqual(
    notes.map((note) => [note.goalNote, note.objective]),
    [['set', 'Ship it today']],
  )
})

const helper = (status, patch = {}) => ({ kind: 'agent', agentId: 'reviewer', name: 'Reviewer', status, ...patch })
const summaries = (rows) => rows.filter((r) => r.kind === 'summary')

test('"Worked for" waits until the thread has stopped: a turn with its result in keeps counting while work goes on', () => {
  const settled = summaries(foldTurns(transcript(finished), false, false))[0]
  assert.equal(settled.label, 'Worked for 1m 5s')
  assert.equal(settled.running, undefined)
  // The agent picked the work up again and has shown nothing new yet.
  assert.deepEqual(summaries(foldTurns(transcript(finished), true, false))[0].running, {
    since: 1_000,
    text: 'Working for {0}',
  })
  // Sub-agents the turn started are still running after the main agent's result.
  const waiting = [finished[0], helper('running', { startedAt: 1_500 }), ...finished.slice(1)]
  assert.deepEqual(summaries(foldTurns(transcript(waiting), false, false))[0].running, {
    since: 1_000,
    text: 'Working for {0}',
  })
  // A background command or an advisor does not hold the turn open.
  for (const taskType of ['local_bash', 'advisor']) {
    const beside = [finished[0], helper('running', { taskType, background: true }), ...finished.slice(1)]
    assert.equal(summaries(foldTurns(transcript(beside), false, false))[0].running, undefined)
  }
  // A stopped turn stays stopped, and an earlier turn is done whatever the thread does next.
  const stopped = [...finished.slice(0, -1), { kind: 'result', isError: false, text: 'interrupted', costUsd: null }]
  assert.equal(summaries(foldTurns(transcript(stopped), true, false))[0].running, undefined)
  const next = [...waiting, { kind: 'user', text: 'next', at: 70_000 }, { kind: 'text', text: 'ok', at: 71_000 }]
  assert.equal(summaries(foldTurns(transcript(next), true, false))[0].running, undefined)
})

test('a background command the agent is waiting on keeps the last turn working until it ends', () => {
  const command = { agentId: 'tests', name: 'pnpm test', taskType: 'local_bash', background: true, startedAt: 1_500 }
  const fold = (events, awaited) => summaries(foldTurns(transcript(events), false, false, undefined, awaited))[0]
  assert.deepEqual(fold(finished, [{ ...command, status: 'running', awaited: true }]).running, {
    since: 1_000,
    text: 'Working for {0}',
  })
  // One left running beside the turn, or restored without a process, does not hold it.
  assert.equal(fold(finished, [{ ...command, status: 'running' }]).running, undefined)
  assert.equal(fold(finished, [{ ...command, status: 'running', awaited: true, recovered: true }]).running, undefined)
  // Once it ends the turn settles, and lasted until then.
  const ended = fold(finished, [{ ...command, status: 'completed', awaited: true, endedAt: 301_000 }])
  assert.equal(ended.running, undefined)
  assert.equal(ended.label, 'Worked for 5m 0s')
})

test('a turn lasted until the sub-agents it started were done, never past the turn after it', () => {
  const reviewed = [finished[0], helper('completed', { startedAt: 1_500, endedAt: 301_000 }), ...finished.slice(1)]
  assert.equal(summaries(foldTurns(transcript(reviewed), false, false))[0].label, 'Worked for 5m 0s')
  const next = [...reviewed, { kind: 'user', text: 'next', at: 121_000 }, { kind: 'text', text: 'ok', at: 122_000 }]
  assert.equal(summaries(foldTurns(transcript(next), false, false))[0].label, 'Worked for 2m 0s')
})

test('work the agent picked up by itself reads as more of the turn above, not a second "Worked for"', () => {
  const events = [
    ...finished,
    { kind: 'thinking', text: 'The checks finished', at: 70_000 },
    ...tool('b', 72_000),
    { kind: 'text', text: 'They passed.', at: 90_000 },
    { kind: 'result', isError: false, text: '', costUsd: null, at: 91_000 },
  ]
  assert.deepEqual(
    summaries(foldTurns(transcript(events), false, false)).map((r) => r.label),
    ['Worked for 1m 5s', 'Continued for 21s'],
  )
  assert.deepEqual(summaries(foldTurns(transcript(events), true, false))[1].running, {
    since: 70_000,
    text: 'Continuing for {0}',
  })
})
