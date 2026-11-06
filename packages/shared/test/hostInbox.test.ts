import { expect, it } from 'vitest'
import {
  blockerTally,
  blockerTallyLine,
  briefRows,
  buildInbox,
  finishedSince,
  inboxBlocker,
  inboxTabOf,
  type InboxChat,
  type InboxRecap,
  type InboxSummary,
} from '../src/hostInbox'
import { hostInboxInput, isHostDestination, type HostOverview } from '../src/hostOverview'

const now = Date.now()
const chat = (computerId: string, taskId = 'same'): InboxChat => ({
  id: JSON.stringify([computerId, taskId]),
  taskId,
  computerId,
  status: 'needs-input',
  lastActiveAt: now,
  sessionId: 'session',
})

it('keeps unfinished goals out of Completed between turns and offers held goals in Needs you', () => {
  const states = ['active', 'paused', 'blocked', 'turn-limit', 'completed'] as const
  const chats: InboxChat[] = states.map((status) => ({
    ...chat('host', status),
    status: 'ready-for-review' as const,
    goalState: { status },
  }))
  chats.push({
    ...chat('host', 'limit'),
    status: 'ready-for-review',
    goalState: { status: 'paused', pausedBy: 'provider-limit' },
  })
  const result = buildInbox({ chats, recaps: [], summaries: [], now })
  expect(result.running.map((item) => item.taskId)).toEqual(['active', 'limit'])
  expect(result.waiting.map((item) => item.taskId)).toEqual(['paused', 'blocked', 'turn-limit'])
  expect(result.completed.map((item) => item.taskId)).toEqual(['completed'])
})

it('keeps a thread with independent helpers still running out of Completed, like the finished-thread gate', () => {
  const idle = { ...chat('host', 'helpers'), status: 'ready-for-review' as const }
  const result = buildInbox({
    chats: [
      { ...idle, helperSummary: { active: 2 } },
      { ...idle, taskId: 'settled', id: 'settled', helperSummary: { active: 0 } },
      { ...idle, taskId: 'asks', id: 'asks', status: 'needs-input' as const, helperSummary: { active: 1 } },
    ],
    recaps: [],
    summaries: [],
    now,
  })
  expect(result.running.map((item) => item.taskId)).toEqual(['helpers'])
  expect(result.completed.map((item) => item.taskId)).toEqual(['settled'])
  // A request waiting on the person still comes first, whatever the helpers are doing.
  expect(result.waiting.map((item) => item.taskId)).toEqual(['asks'])
})

it('prefers a refreshed mobile goal over a stale task summary, including an explicitly cleared goal', () => {
  const base = { ...chat('host'), status: 'idle' as const, goalState: { status: 'active' as const } }
  const result = buildInbox({
    chats: [
      { ...base, id: 'cleared', goal: null },
      { ...base, id: 'completed', goal: { status: 'completed' } },
    ],
    recaps: [],
    summaries: [],
    now,
  })
  expect(result.running).toEqual([])
  expect(result.completed.map((item) => item.id)).toEqual(['cleared', 'completed'])
})

it('filters every inbox section and badge by the owning host even when resource IDs collide', () => {
  const chats = [chat('a'), chat('b')]
  const recaps = ['a', 'b'].map((computerId) => ({
    computerId,
    item: {
      id: 'same',
      taskId: 'same',
      group: 'attention',
      status: 'open',
      updatedAt: now,
    } as HostOverview['recaps'][number],
  }))
  const summaries = ['a', 'b'].map((computerId) => ({
    computerId,
    summary: {
      id: 'same',
      status: 'unread',
      periodEnd: now,
    } as HostOverview['summaries'][number],
  }))
  const all = buildInbox({ chats, recaps, summaries, now })
  expect(all.needsYou).toBe(4)
  const filtered = buildInbox({ chats, recaps, summaries, computerId: 'b', now })
  expect(filtered.needsYou).toBe(2)
  expect(filtered.waiting.map((c) => c.computerId)).toEqual(['b'])
  expect(filtered.attention.map((r) => r.computerId)).toEqual(['b'])
  expect(filtered.summaries.map((s) => s.computerId)).toEqual(['b'])
  expect(chats).toHaveLength(2)
})

it('applies host filtering before learned/completed limits and day grouping', () => {
  const summaries: InboxSummary[] = Array.from({ length: 30 }, (_, i) => ({
    computerId: 'a',
    summary: {
      id: `${i}`,
      periodEnd: now + i,
      status: 'unread',
    } as InboxSummary['summary'],
  }))
  summaries.push({
    computerId: 'b',
    summary: { id: 'older', periodEnd: now - 1000, status: 'unread' } as InboxSummary['summary'],
  })
  const chats = Array.from({ length: 60 }, (_, i) => ({ ...chat('a', `${i}`), status: 'idle' as const }))
  chats.push({ ...chat('b'), status: 'idle', lastActiveAt: now - 1000 })
  const result = buildInbox({ chats, summaries, recaps: [], computerId: 'b', now })
  expect(result.summaries.map((s) => s.summary.id)).toEqual(['older'])
  expect(result.completed.map((c) => c.computerId)).toEqual(['b'])
  expect(result.days.flatMap((day) => day.items)).toHaveLength(1)
})

it('uses active agent state and routes native helpers to their parent session on their own host', () => {
  const data = {
    projects: [],
    recaps: [],
    summaries: [],
    errors: [],
    tasks: [{ id: 'same', projectId: 'p', title: 'Task', status: 'idle', lastActiveAt: now }],
    agents: [
      { id: 'old', taskId: 'same', createdAt: 1, state: 'idle' },
      {
        id: 'helper',
        taskId: 'same',
        createdAt: 2,
        state: 'needs-input',
        nativeTask: { agentId: 'h' },
        parentId: 'parent',
      },
    ],
  } as unknown as HostOverview
  const input = hostInboxInput([
    { id: 'a', data },
    { id: 'b', data },
  ])
  expect(new Set(input.chats.map((c) => c.id)).size).toBe(2)
  expect(input.chats[1]).toMatchObject({ computerId: 'b', taskId: 'same', status: 'needs-input', sessionId: 'parent' })
  expect(buildInbox(input).waiting).toHaveLength(2)
})

it('validates navigation destinations before IPC dispatch', () => {
  for (const destination of [
    { kind: 'inbox' },
    { kind: 'new' },
    { kind: 'new', projectId: 'p' },
    { kind: 'task', taskId: 't' },
    { kind: 'task', taskId: 't', sessionId: 'helper', requestId: 'r' },
    { kind: 'summary', summaryId: 's' },
    { kind: 'project', projectId: 'p' },
  ])
    expect(isHostDestination(destination)).toBe(true)
  for (const destination of [
    null,
    'task',
    { kind: 'task' },
    { kind: 'task', taskId: '' },
    { kind: 'task', taskId: 't', sessionId: 3 },
    // A request is always addressed within its session.
    { kind: 'task', taskId: 't', requestId: 'r' },
    { kind: 'shell', command: 'x' },
    // Adding a project on another host now runs in the window that asks (its own folder browser).
    { kind: 'add-project' },
  ])
    expect(isHostDestination(destination)).toBe(false)
})

it('preserves done markers when adapting desktop tasks into the shared inbox', () => {
  const data = {
    projects: [],
    agents: [],
    recaps: [],
    summaries: [],
    errors: [],
    tasks: [{ id: 'done', status: 'needs-input', lastActiveAt: now, doneAt: now }],
  } as unknown as HostOverview
  const input = hostInboxInput([{ id: 'a', data }])
  expect(input.chats[0]?.doneAt).toBe(now)
  expect(buildInbox(input).waiting).toEqual([])
})

it('only accepts supported host thread commands with the required arguments', async () => {
  const { isHostTaskCommand } = await import('../src/hostOverview')
  expect(isHostTaskCommand('tasks.pin', ['same-id', true])).toBe(true)
  expect(isHostTaskCommand('tasks.rename', ['same-id', 'Renamed'])).toBe(true)
  expect(isHostTaskCommand('tasks.delete', ['same-id', false])).toBe(true)
  expect(isHostTaskCommand('tasks.pin', ['same-id', 'true'])).toBe(false)
  expect(isHostTaskCommand('tasks.rename', ['same-id', ' '])).toBe(false)
  expect(isHostTaskCommand('tasks.delete', ['', true])).toBe(false)
  expect(isHostTaskCommand('background.stop', [])).toBe(false)
})

it('puts async questions and approvals in Waiting even when execution continues, and keeps them out of Completed', () => {
  const summary = { count: 1, approvals: 1, connectors: 0, requests: [] }
  const chats: InboxChat[] = [
    {
      id: 'live',
      computerId: 'a',
      taskId: 'live',
      sessionId: 's',
      status: 'running',
      lastActiveAt: now,
      inputSummary: summary,
    },
    {
      id: 'idle',
      computerId: 'a',
      taskId: 'idle',
      sessionId: 'i',
      status: 'idle',
      lastActiveAt: now,
      inputSummary: { ...summary, approvals: 0 },
    },
  ]
  const result = buildInbox({ chats, recaps: [], summaries: [] })
  expect(result.waiting.map((chat) => chat.id)).toEqual(['live', 'idle'])
  expect(result.running).toEqual([])
  expect(result.days.flatMap((day) => day.items)).toEqual([])
  const cleared = buildInbox({
    chats: chats.map((chat) => ({ ...chat, inputSummary: null })),
    recaps: [],
    summaries: [],
  })
  expect(cleared.waiting).toEqual([])
  expect(cleared.running.map((chat) => chat.id)).toEqual(['live'])
})

it('treats a host that sends no goal summary as unknown rather than inventing a goal or hiding the thread', () => {
  const data = {
    projects: [],
    recaps: [],
    summaries: [],
    errors: [],
    tasks: [{ id: 't', projectId: 'p', title: 'Old host task', status: 'ready-for-review', lastActiveAt: now }],
    agents: [{ id: 's', taskId: 't', createdAt: 1, state: 'idle' }],
  } as unknown as HostOverview
  const input = hostInboxInput([{ id: 'old', data }])
  expect(input.chats[0]?.goalState).toBeUndefined()
  const result = buildInbox({ ...input, now })
  expect(result.running).toEqual([])
  expect(result.completed.map((item) => item.taskId)).toEqual(['t'])
})

it('says what a waiting thread needs: requests first (approval, connector, question), then the goal', () => {
  const base = { ...chat('host'), status: 'ready-for-review' as const }
  const summary = (approvals: number, connectors: number, count: number) => ({
    count,
    approvals,
    connectors,
    requests: [],
  })
  expect(inboxBlocker({ ...base, inputSummary: summary(2, 1, 4) })).toEqual({ kind: 'approval', count: 2 })
  expect(inboxBlocker({ ...base, inputSummary: summary(0, 1, 3) })).toEqual({ kind: 'connector', count: 1 })
  expect(inboxBlocker({ ...base, inputSummary: summary(0, 0, 3) })).toEqual({ kind: 'question', count: 3 })
  expect(inboxBlocker({ ...base, goalState: { status: 'blocked', reason: 'Needs a test database' } })).toEqual({
    kind: 'goal-blocked',
    reason: 'Needs a test database',
  })
  expect(
    inboxBlocker({ ...base, goalState: { status: 'blocked', verificationFailed: true, reason: 'tests failed' } }),
  ).toEqual({ kind: 'verification-failed', reason: 'tests failed' })
  expect(inboxBlocker({ ...base, goalState: { status: 'turn-limit' } })).toEqual({ kind: 'turn-limit' })
  expect(inboxBlocker({ ...base, goalState: { status: 'paused' } })).toEqual({ kind: 'goal-paused' })
})

it('gives no blocker for a thread that is not waiting, and a generic question when only the status says so', () => {
  const base = { ...chat('host'), status: 'ready-for-review' as const }
  expect(inboxBlocker(base)).toBeNull()
  expect(inboxBlocker({ ...base, goalState: { status: 'active' } })).toBeNull()
  expect(inboxBlocker({ ...base, goalState: { status: 'paused', pausedBy: 'provider-limit' } })).toBeNull()
  expect(inboxBlocker({ ...base, status: 'needs-input' })).toEqual({ kind: 'question', count: 1 })
})

it('tallies waiting threads by what they need, in the order a person acts on them', () => {
  const waiting = (taskId: string, extra: Partial<InboxChat>): InboxChat => ({ ...chat('host', taskId), ...extra })
  const input = (approvals: number, connectors: number, count: number) => ({
    count,
    approvals,
    connectors,
    questions: count - approvals - connectors,
    other: 0,
    requests: [],
  })
  const tally = blockerTally([
    waiting('a', { inputSummary: input(0, 1, 1) }),
    waiting('b', { inputSummary: input(2, 0, 2) }),
    waiting('c', { inputSummary: input(1, 1, 2) }),
    waiting('d', { status: 'ready-for-review' }),
    waiting('e', { goalState: { status: 'turn-limit' } }),
  ])
  expect(tally).toEqual([
    { kind: 'approval', threads: 2 },
    { kind: 'connector', threads: 1 },
    { kind: 'turn-limit', threads: 1 },
  ])
  expect(blockerTally([])).toEqual([])
})

it('writes the tally as one translated line', () => {
  const line = blockerTallyLine(
    [
      { kind: 'approval', threads: 2 },
      { kind: 'connector', threads: 1 },
    ],
    (source, values) => source.replace('{0}', String(values['0'])),
  )
  expect(line).toBe('2 need approval · 1 need sign-in')
})

it('groups sign-ins by connector so threads waiting on the same one read as a single ask', () => {
  const request = (connector?: string) => ({
    sessionId: 's',
    requestId: 'r',
    kind: 'connector' as const,
    title: 'Sign in',
    ...(connector ? { connector } : {}),
  })
  const signIn = (taskId: string, connector?: string): InboxChat => ({
    ...chat('host', taskId),
    inputSummary: { count: 1, approvals: 0, connectors: 1, requests: [request(connector)] },
  })
  const tally = blockerTally([signIn('a', 'Atlassian'), signIn('b', 'Atlassian'), signIn('c', 'Linear'), signIn('d')])
  expect(tally).toEqual([
    { kind: 'connector', threads: 2, connector: 'Atlassian' },
    { kind: 'connector', threads: 1, connector: 'Linear' },
    { kind: 'connector', threads: 1 },
  ])
  expect(blockerTallyLine(tally, (source, values) => source.replace(/\{(\d)\}/g, (_m, i) => String(values[i])))).toBe(
    '2 need sign-in to Atlassian · 1 need sign-in to Linear · 1 need sign-in',
  )
  expect(inboxBlocker(signIn('a', 'Atlassian'))).toEqual({ kind: 'connector', count: 1, connector: 'Atlassian' })
})

it('orders the Brief: requests, failures, limits, then recaps, and counts failures until seen', () => {
  const blocked = { ...chat('a', 'goal'), status: 'idle' as const, goalState: { status: 'turn-limit' as const } }
  const failed = { ...chat('b', 'failed'), status: 'failed' as const }
  const approval = {
    ...chat('a', 'approval'),
    inputSummary: { count: 1, approvals: 1, connectors: 0, requests: [] },
  }
  const item = { id: 'r', taskId: 'failed', group: 'attention', status: 'open', updatedAt: now } as InboxRecap['item']
  const input = { chats: [blocked, failed, approval], recaps: [{ computerId: 'b', item }], summaries: [], now }
  const model = buildInbox(input)
  expect(briefRows(model).map((row) => row.kind + (row.kind === 'blocker' ? `:${row.chat.taskId}` : ''))).toEqual([
    'blocker:approval',
    'failure',
    'blocker:goal',
    'recap',
  ])
  expect(model.needsYou).toBe(4)
  const seen = buildInbox({ ...input, failureSeen: (entry) => entry.taskId === 'failed' })
  expect(seen.needsYou).toBe(3)
  expect(seen.failed).toEqual([])
  // Seen failures still belong in finished work; only the ask goes away.
  expect(seen.completed.map((entry) => entry.taskId)).toContain('failed')
})

it('opens retired or unknown tabs on the Brief', () => {
  expect(inboxTabOf('all')).toBe('brief')
  expect(inboxTabOf('needs-you')).toBe('brief')
  expect(inboxTabOf('recaps')).toBe('recaps')
})

it('counts finished threads since the last visit', () => {
  const finished = { ...chat('a', 'done'), status: 'ready-for-review' as const, lastActiveAt: now - 10 }
  const model = buildInbox({ chats: [finished], recaps: [], summaries: [], now })
  expect(finishedSince(model, now - 20)).toBe(1)
  expect(finishedSince(model, now)).toBe(0)
})

it('asks for pull requests whose next step is the person’s, after requests and beside failures', () => {
  const pr = (taskId: string, stage: 'replies-ready' | 'ready' | 'checks-pending'): InboxChat => ({
    ...chat('host', taskId),
    status: 'idle',
    pullRequest: { repoId: 'r', number: 3, title: 'Fix', url: `u/${taskId}`, state: 'open', draft: false, stage },
  })
  const approval = {
    ...chat('host', 'approval'),
    inputSummary: { count: 1, approvals: 1, connectors: 0, requests: [] },
  }
  const model = buildInbox({
    chats: [pr('replies', 'replies-ready'), pr('merge', 'ready'), pr('waiting', 'checks-pending'), approval],
    recaps: [],
    summaries: [],
    now,
  })
  expect(model.pullRequests.map((entry) => entry.taskId).sort()).toEqual(['merge', 'replies'])
  expect(briefRows(model).map((row) => row.kind)).toEqual(['blocker', 'pull-request', 'pull-request'])
  expect(model.needsYou).toBe(3)
})
