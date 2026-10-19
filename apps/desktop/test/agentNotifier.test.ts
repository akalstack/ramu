import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => false
  },
}))
const { createAgentNotifier } = await import('../src/main/agentNotifier')

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(goal: unknown = null) {
  const send = vi.fn()
  const invoke = vi.fn(async (method: string) => {
    if (method === 'agent.goal') return goal
    if (method === 'agent.get') return { id: 's1', taskId: 't1', title: 'A thread' }
    if (method === 'tasks.list') return [{ id: 't1', title: 'A thread' }]
    return null
  })
  const window = {
    isDestroyed: () => false,
    isFocused: () => true,
    isVisible: () => true,
    isMinimized: () => false,
  } as unknown as BrowserWindow
  const notifier = createAgentNotifier({
    window,
    send,
    invoke,
    preferences: async () => ({ notifyAgentDone: true }) as never,
  })
  return { notifier, send }
}
const wait = (extra: Record<string, unknown>) => ({
  sessionId: 's1',
  event: { kind: 'provider-wait', retryAt: 5_000, updatedAt: 1, ...extra },
})

it('tells the user once when a limit reset while auto-resume is off', async () => {
  const { notifier, send } = setup()
  notifier.observe('agent:event', wait({ resetNotifiedAt: 7_000 }))
  notifier.observe('agent:event', wait({ resetNotifiedAt: 7_000 }))
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(
    'notify:inapp',
    expect.objectContaining({ kind: 'input', body: expect.stringContaining('Limit has reset') }),
  )
})

it('stays quiet for a wait that has not reset, and for a cleared wait', async () => {
  const { notifier, send } = setup()
  notifier.observe('agent:event', wait({}))
  notifier.observe('agent:event', wait({ retryAt: null, resetNotifiedAt: 7_000 }))
  await flush()
  expect(send).not.toHaveBeenCalled()
})

it('announces a later wait again', async () => {
  const { notifier, send } = setup()
  notifier.observe('agent:event', wait({ resetNotifiedAt: 7_000 }))
  notifier.observe('agent:event', wait({ resetNotifiedAt: 9_000 }))
  await flush()
  expect(send).toHaveBeenCalledTimes(2)
})

const turnEnds = async (goal: unknown) => {
  const { notifier, send } = setup(goal)
  notifier.observe('agent:event', { sessionId: 's1', event: { kind: 'state', state: 'running' } })
  notifier.observe('agent:event', { sessionId: 's1', event: { kind: 'state', state: 'idle' } })
  await flush()
  return send
}
const heldGoal = (patch: Record<string, unknown>) => ({
  id: 'g',
  objective: 'Ship',
  turns: 1,
  reason: '',
  updatedAt: 1,
  ...patch,
})

it('does not say a turn is done while its goal waits out a usage limit, in the merged or the older shape', async () => {
  expect(await turnEnds(heldGoal({ status: 'paused', pausedBy: 'provider-limit' }))).not.toHaveBeenCalled()
  expect(await turnEnds(heldGoal({ status: 'waiting-provider' }))).not.toHaveBeenCalled()
  expect(await turnEnds(heldGoal({ status: 'active' }))).not.toHaveBeenCalled()
})

it('still says a turn is done when its goal was paused by the user', async () => {
  expect(await turnEnds(heldGoal({ status: 'paused', pausedBy: 'user' }))).toHaveBeenCalledTimes(1)
  expect(await turnEnds(heldGoal({ status: 'paused' }))).toHaveBeenCalledTimes(1)
  expect(await turnEnds(null)).toHaveBeenCalledTimes(1)
})
