import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

function stubStorage() {
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
  return data
}

const task = (id: string, lastActiveAt: number) => ({ id, title: id, lastActiveAt, projectId: 'p1' }) as unknown as Task

it('keeps another host’s lists so it opens while away, newest threads first', async () => {
  stubStorage()
  vi.useFakeTimers()
  const { saveOfflineCopy, hasOfflineCopy } = await import('../src/workspace/offlineCopy')
  expect(hasOfflineCopy('studio')).toBe(false)
  saveOfflineCopy('studio', {
    projects: [{ id: 'p1', name: 'app' } as never],
    tasks: [task('old', 1), task('new', 9)],
    workspaces: [],
    repos: { p1: [{ id: 'r1' } as never] },
  })
  expect(hasOfflineCopy('studio')).toBe(true)
  vi.advanceTimersByTime(2500)
  // A fresh start of the app reads it back for that host alone.
  vi.resetModules()
  const fresh = await import('../src/workspace/offlineCopy')
  expect(fresh.readOfflineCopy('studio')).toMatchObject({
    tasks: [{ id: 'new' }, { id: 'old' }],
    projects: [{ id: 'p1' }],
    repos: { p1: [{ id: 'r1' }] },
  })
  expect(fresh.readOfflineCopy('laptop')).toBeNull()
})

it('never keeps a copy of this machine’s own host, which is always reachable from its window', async () => {
  stubStorage()
  vi.useFakeTimers()
  const { saveOfflineCopy, hasOfflineCopy } = await import('../src/workspace/offlineCopy')
  saveOfflineCopy('local', { projects: [], tasks: [task('a', 1)], workspaces: [], repos: {} })
  vi.advanceTimersByTime(2500)
  expect(hasOfflineCopy('local')).toBe(false)
})

it('falls back to the last sidebar overview for a host whose store was never opened here', async () => {
  const data = stubStorage()
  data.set('host:studio:last-overview', JSON.stringify({ tasks: [task('t1', 3)], projects: [{ id: 'p1' }] }))
  const { readOfflineCopy, hasOfflineCopy } = await import('../src/workspace/offlineCopy')
  expect(hasOfflineCopy('studio')).toBe(true)
  expect(readOfflineCopy('studio')).toEqual({
    tasks: [task('t1', 3)],
    projects: [{ id: 'p1' }],
    workspaces: [],
    repos: {},
  })
})
