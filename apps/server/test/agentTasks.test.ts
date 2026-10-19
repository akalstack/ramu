import { expect, it, vi } from 'vitest'
import type { AgentEvent, AgentTask } from '@ramu/shared/types'
import { AgentTasks, type AgentTasksHost } from '../src/agent/agentTasks'
import { forwardedRequestId } from '../src/agent/childRequests'
import type { ForwardedRequest } from '../src/agent/childRequests'
import { SubagentRunner } from '../src/agent/subagentRunner'
import { openDb } from '../src/db'
function fixture(initial: AgentTask) {
  let current = initial
  const record = vi.fn((_id: string, event: AgentEvent) => {
    if (event.kind === 'agent') current = event
  })
  const host = {
    task: () => current,
    record,
    syncTaskStatus: () => false,
    get: () => ({ state: 'running' }),
    children: new Map(),
    continueNative: vi.fn(),
    submit: vi.fn(),
  }
  const db = openDb(':memory:')
  return {
    service: new AgentTasks(host as unknown as AgentTasksHost, db),
    record,
    host,
    task: () => current,
    close: () => db.close(),
  }
}
it('does not resurrect a settled helper from late progress; explicit resume starts a new clock', () => {
  const f = fixture({
    agentId: 'a',
    name: 'A',
    status: 'completed',
    endedAt: 20,
    startedAt: 1,
    durationMs: 19,
    recovered: true,
  })
  try {
    f.service.updateTask('parent', 'a', { status: 'running', summary: 'late' })
    expect(f.record).not.toHaveBeenCalled()
    f.service.updateTask('parent', 'a', { status: 'running', resumedAt: 20 })
    expect(f.task()).toMatchObject({ status: 'running', startedAt: 21, resumedAt: 21, recovered: false })
    expect(f.task().endedAt).toBeUndefined()
    expect(f.task().durationMs).toBeUndefined()
  } finally {
    f.close()
  }
})
it('checks helper capabilities again at the server action boundary', async () => {
  const f = fixture({ agentId: 'a', name: 'A', status: 'running', canStop: false, canMessage: false })
  try {
    await expect(f.service.stopTask('parent', 'a')).rejects.toThrow(/cannot be stopped/)
    await expect(f.service.messageTask('parent', 'a', 'message')).rejects.toThrow(/cannot receive messages/)
    expect(f.host.submit).not.toHaveBeenCalled()
  } finally {
    f.close()
  }
})
it('preserves child request ownership when forwarding a question to its parent', () => {
  const record = vi.fn()
  const childRequests = new Map<string, ForwardedRequest>()
  const runner = new SubagentRunner({ record, childRequests } as unknown as ConstructorParameters<
    typeof SubagentRunner
  >[0])
  const run = { parentId: 'parent', name: 'Helper' } as Parameters<SubagentRunner['mirrorChild']>[1]
  runner.mirrorChild('child', run, { kind: 'question', requestId: 'q', questions: [] })
  expect(childRequests.get(forwardedRequestId('parent', 'child', 'q'))).toEqual({
    parentId: 'parent',
    childId: 'child',
    requestId: 'q',
  })
  expect(record).toHaveBeenCalledWith(
    'parent',
    expect.objectContaining({
      requestId: forwardedRequestId('parent', 'child', 'q'),
      requestSource: { sessionId: 'child', agentId: 'child', name: 'Helper', requestId: 'q' },
    }),
  )
})

it('keeps duplicate native request IDs isolated and restores answer routing from saved origins', async () => {
  const { UserRequests } = await import('../src/agent/userRequests')
  const db = openDb(':memory:')
  try {
    const native: AgentEvent = {
      kind: 'permission-request',
      requestId: '1',
      toolName: 'Bash',
      title: 'Approve',
      detail: 'test',
    }
    const first = forwardedRequestId('parent', 'a', '1')
    const second = forwardedRequestId('parent', 'b', '1')
    expect(first).not.toBe(second)
    expect(forwardedRequestId('other-parent', 'a', '1')).not.toBe(first)
    expect(forwardedRequestId('p', 'c', 'x'.repeat(1000)).length).toBeLessThan(100)
    const a = vi.fn(),
      b = vi.fn()
    const saved: Record<string, AgentEvent[]> = {
      parent: [
        { ...native, requestId: first, requestSource: { sessionId: 'a', agentId: 'a', name: 'A', requestId: '1' } },
        { ...native, requestId: second, requestSource: { sessionId: 'b', agentId: 'b', name: 'B', requestId: '1' } },
      ],
      a: [native],
      b: [native],
      unrelated: [],
    }
    const requests = new UserRequests(
      {
        events: (id: string) => saved[id] ?? [],
        get: () => ({ taskId: 'no-project', provider: 'codex' }),
        runners: new Map([
          ['a', { replyPermission: a }],
          ['b', { replyPermission: b }],
        ]),
      } as unknown as ConstructorParameters<typeof UserRequests>[0],
      db,
    )
    // No in-memory forwarding map: exercise restored ownership from the saved parent events.
    requests.replyPermission('parent', second, true)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith('1', true)
    requests.replyPermission('parent', first, false)
    expect(a).toHaveBeenCalledWith('1', false)
    expect(() => requests.replyPermission('unrelated', second, true)).toThrow(/does not belong/)
  } finally {
    db.close()
  }
})
