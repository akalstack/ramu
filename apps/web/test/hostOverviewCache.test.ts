import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'

vi.mock('../src/ipc', () => ({ ramu: { on: () => () => {}, invoke: async () => ({}) } }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/workspaceLifetime', () => ({
  onWorkspaceVisibility: () => () => {},
  workspaceVisible: () => true,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('keeps a host’s last rows on this device, so an offline host lists its threads after a restart', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { ramu: { hostId: 'local' } })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  })
  vi.useFakeTimers()
  const { rememberHostRows, readLastOverview } = await import('../src/workspace/hostOverview')
  const task = { id: 't1', title: 'Fix login', lastActiveAt: 5, projectId: 'p1' } as unknown as Task
  rememberHostRows('studio', { tasks: [task], projects: [{ id: 'p1', name: 'app' } as never] })
  expect(readLastOverview('studio')).toBeUndefined()
  vi.advanceTimersByTime(2500)
  // A fresh start of the app reads it back for that host alone.
  vi.resetModules()
  const fresh = await import('../src/workspace/hostOverview')
  expect(fresh.readLastOverview('studio')).toMatchObject({
    tasks: [{ id: 't1' }],
    projects: [{ id: 'p1' }],
    errors: [],
  })
  expect(fresh.readLastOverview('other')).toBeUndefined()
})
