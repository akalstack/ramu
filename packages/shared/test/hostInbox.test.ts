import { expect, it } from 'vitest'
import { buildInbox, type InboxChat, type InboxSummary } from '../src/hostInbox'
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
  const summary = { count: 1, approvals: 1, requests: [] }
  const chats: InboxChat[] = [
    {
      id: 'live',
      computerId: 'a',
      taskId: 'live',
      sessionId: 's',
      status: 'running',
      lastActiveAt: Date.now(),
      inputSummary: summary,
    },
    {
      id: 'idle',
      computerId: 'a',
      taskId: 'idle',
      sessionId: 'i',
      status: 'idle',
      lastActiveAt: Date.now(),
      inputSummary: { ...summary, approvals: 0 },
    },
  ]
  const result = buildInbox({ chats, recaps: [], summaries: [] })
  expect(result.waiting.map((chat) => chat.id)).toEqual(['live', 'idle'])
  expect(result.running).toEqual([])
  expect(result.completed.flatMap((day) => day.items)).toEqual([])
  const cleared = buildInbox({
    chats: chats.map((chat) => ({ ...chat, inputSummary: null })),
    recaps: [],
    summaries: [],
  })
  expect(cleared.waiting).toEqual([])
  expect(cleared.running.map((chat) => chat.id)).toEqual(['live'])
})
