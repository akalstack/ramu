import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDispatcher, type Services } from '../src/ipc'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('tells every client once when threads or projects change, and stays quiet for reads', async () => {
  const sent: string[] = []
  const dispatcher = createDispatcher(
    {
      userData: '/tmp/ramu-workspace-changed',
      send: (channel) => {
        sent.push(channel)
      },
      native: async () => null,
    },
    {
      workspace: {
        getAppState: (_key: string, fallback: unknown) => fallback,
        setAppState: () => {},
        listTasks: () => [],
        renameTask: () => ({}),
        setPinned: () => ({}),
        setArchived: () => ({}),
      },
    } as unknown as Services,
  )
  try {
    dispatcher.invoke('tasks.list', [])
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).not.toContain('workspace:changed')

    dispatcher.invoke('tasks.rename', ['task-1', 'New title'])
    dispatcher.invoke('tasks.pin', ['task-1', true])
    await vi.advanceTimersByTimeAsync(100)
    expect(sent.filter((channel) => channel === 'workspace:changed')).toHaveLength(1)
  } finally {
    dispatcher.close()
  }
})
