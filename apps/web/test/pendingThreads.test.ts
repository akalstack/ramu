import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT } from '@ramu/shared/types'
import {
  createPendingThreads,
  deliverPendingThread,
  PENDING_THREAD_LIMIT,
  withRecalled,
} from '../src/composer/pendingThreads'

const memory = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}
const draft = {
  hostId: 'mini',
  projectId: 'project',
  mode: 'current' as const,
  title: 'Fix login',
  prompt: 'Fix the login bug',
  settings: DEFAULT_AGENT_SETTINGS,
  context: [],
}

describe('threads waiting for their host', () => {
  it('keeps them across a restart, and one cut off mid-send waits for a person', () => {
    const store = memory()
    const first = createPendingThreads(store)
    const item = first.add(draft, 'local-1', 1)
    first.update(item.id, { state: 'sending' })
    const again = createPendingThreads(store).snapshot()
    expect(again[0]).toMatchObject({ id: 'local-1', state: 'failed' })
  })

  it('moves to another host with its project chosen there, and limits how many wait per host', () => {
    const box = createPendingThreads(memory())
    const item = box.add(draft)
    box.move(item.id, 'laptop')
    expect(box.snapshot()[0]).toMatchObject({ hostId: 'laptop', projectId: null, state: 'waiting' })
    for (let n = 0; n < PENDING_THREAD_LIMIT; n++) box.add(draft)
    expect(() => box.add(draft)).toThrow(/Too many/)
  })

  it('starts on the host with its own id as the creation request, choosing the project when it was Auto', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'projects.route') return { kind: 'unknown' }
      if (method === 'tasks.create') return { id: 'task' }
      if (method === 'agent.start') return { id: 'session' }
      return null
    })
    const result = await deliverPendingThread(
      { ...draft, id: 'local-1', projectId: null, createdAt: 1, state: 'sending' },
      invoke,
    )
    expect(result).toEqual({ taskId: 'task', sessionId: 'session' })
    expect(invoke).toHaveBeenCalledWith(
      'tasks.create',
      expect.objectContaining({ projectId: NO_PROJECT, requestId: 'local-1' }),
    )
    expect(invoke).toHaveBeenCalledWith('agent.start', 'task', 'Fix the login bug', DEFAULT_AGENT_SETTINGS, [], [])
  })

  it('takes a waiting thread back for editing, but not one being started', () => {
    const box = createPendingThreads(memory())
    const waiting = box.add(draft, 'a')
    const starting = box.add(draft, 'b')
    box.update(starting.id, { state: 'sending' })
    expect(box.take(starting.id)).toBeUndefined()
    expect(box.take(waiting.id)?.prompt).toBe('Fix the login bug')
    expect(box.snapshot().map((item) => item.id)).toEqual(['b'])
  })

  it('puts a recalled first message after what is already in the message box', () => {
    expect(withRecalled('', 'Fix it')).toBe('Fix it')
    expect(withRecalled('  ', 'Fix it')).toBe('Fix it')
    expect(withRecalled('Also check tests\n', 'Fix it')).toBe('Also check tests\n\nFix it')
  })
})
