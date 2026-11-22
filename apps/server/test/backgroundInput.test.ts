import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentEvent, QueuedMessage } from '@ramu/shared/types'
import { MessageDispatcher, type MessageDispatcherHost } from '../src/agent/messageDispatcher'
import { currentBranch } from '../src/workspace/git'
vi.mock('../src/workspace/git', () => ({ currentBranch: vi.fn() }))
let messages: QueuedMessage[], paused: boolean
let dispatcher: MessageDispatcher
let send: ReturnType<typeof vi.fn>
const feedback: QueuedMessage = {
  id: 'feedback',
  text: 'Fix PR',
  mode: 'queue',
  checkout: { cwd: '/repo', branch: 'fix' },
}
beforeEach(() => {
  vi.resetAllMocks()
  messages = []
  paused = false
  send = vi.fn().mockResolvedValue(undefined)
  dispatcher = new MessageDispatcher({
    shutdown: () => false,
    get: () => ({ id: 'session', state: 'idle', covers: ['/repo'] }),
    queued: () => messages,
    queuePaused: () => paused,
    threadDone: () => false,
    providerWait: () => null,
    transitioning: new Set(),
    activeWriter: () => null,
    record: (_id: string, event: AgentEvent) => {
      if (event.kind === 'queue') {
        messages = event.messages
        paused = !!event.paused
      }
    },
    send,
  } as unknown as MessageDispatcherHost)
  vi.mocked(currentBranch).mockResolvedValue('fix')
})

it('keeps background feedback durable and leaves a paused queue paused', async () => {
  paused = true
  dispatcher.enqueueBackground('session', 'Fix PR', feedback.checkout!)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(messages).toEqual([expect.objectContaining({ text: 'Fix PR', mode: 'queue', checkout: feedback.checkout })])
  expect(paused).toBe(true)
  expect(send).not.toHaveBeenCalled()
})

it('sends queued feedback through the normal follow-up path when idle', async () => {
  dispatcher.enqueueBackground('session', 'Fix PR', feedback.checkout!)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(send).toHaveBeenCalledWith('session', 'Fix PR', [], undefined, true, undefined, false, undefined, false)
  expect(messages).toEqual([])
})

it('wakes background input restored from disk without duplicating the message', async () => {
  messages = [feedback]
  dispatcher.wakeBackground('session')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(send).toHaveBeenCalledOnce()
  expect(messages).toEqual([])
})

it('holds and pauses feedback if the user switched branches before dispatch', async () => {
  messages = [feedback]
  vi.mocked(currentBranch).mockResolvedValue('other')
  await dispatcher.dispatchQueued('session')
  expect(send).not.toHaveBeenCalled()
  expect(messages).toEqual([feedback])
  expect(paused).toBe(true)
  await expect(dispatcher.sendQueuedNow('session', feedback.id)).rejects.toThrow('waiting for branch fix')
  expect(messages).toEqual([feedback])
})

it('keeps checkout-specific feedback separate from ordinary queued messages', async () => {
  messages = [{ id: 'user', text: 'Question' }, feedback]
  await dispatcher.dispatchQueued('session')
  expect(send).toHaveBeenLastCalledWith('session', 'Question', [], undefined, true, undefined, false, undefined, false)
  expect(messages).toEqual([feedback])
  await dispatcher.dispatchQueued('session')
  expect(send).toHaveBeenLastCalledWith('session', 'Fix PR', [], undefined, true, undefined, false, undefined, false)
})

it('prevents duplicate sends while the checkout is being validated', async () => {
  messages = [feedback]
  let resolveBranch!: (value: string) => void
  vi.mocked(currentBranch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveBranch = resolve
      }),
  )
  const first = dispatcher.sendQueuedNow('session', feedback.id)
  await expect(dispatcher.sendQueuedNow('session', feedback.id)).rejects.toThrow('already being sent')
  await dispatcher.dispatchQueued('session')
  expect(send).not.toHaveBeenCalled()
  resolveBranch('fix')
  await first
  expect(send).toHaveBeenCalledOnce()
})

it('revisits a session skipped as busy when the workspace frees during a pass', async () => {
  const sessions: Record<string, { state: string; covers: string[] }> = {
    a: { state: 'idle', covers: ['/a'] },
    b: { state: 'idle', covers: ['/b'] },
  }
  const queues: Record<string, QueuedMessage[]> = {
    a: [{ id: 'ma', text: 'A', mode: 'queue' }],
    b: [{ id: 'mb', text: 'B', mode: 'queue' }],
  }
  let release!: () => void
  const slow = new Promise<void>((resolve) => (release = resolve))
  const sent: string[] = []
  const d = new MessageDispatcher({
    shutdown: () => false,
    get: (id: string) => ({ id, ...sessions[id]! }),
    queued: (id: string) => queues[id]!,
    queuePaused: () => false,
    threadDone: () => false,
    providerWait: () => null,
    transitioning: new Set(),
    activeWriter: () => null,
    record: (id: string, event: AgentEvent) => {
      if (event.kind === 'queue') queues[id] = event.messages
    },
    send: async (id: string) => {
      sent.push(id)
      if (id === 'a') await slow
    },
  } as unknown as MessageDispatcherHost)
  d.workspaceReservations.add('/b')
  d.workspaceQueue.add('b')
  d.workspaceQueue.add('a')
  d.wakeWorkspaceQueue()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(sent).toEqual(['a'])
  d.workspaceReservations.delete('/b')
  d.wakeWorkspaceQueue()
  release()
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
  expect(sent).toEqual(['a', 'b'])
})
