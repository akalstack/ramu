import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '@ramu/shared/types'
import { commitUnread, inboxUnread, loadUnread, statusUnread } from '../src/workspace/unread'
import { hostStore, type Store } from '../src/hostStorage'

const memory = (): Store => {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}
const task = (id: string, status: TaskStatus) => ({ id, status })

describe('unread marks', () => {
  it('marks a chat that finished while you looked elsewhere, and clears it once you watch it', () => {
    const previous = new Map<string, TaskStatus>([['a', 'running']])
    const marked = statusUnread(new Set(), [task('a', 'ready-for-review')], previous, () => false)
    expect([...marked]).toEqual(['a'])
    expect([...statusUnread(marked, [task('a', 'ready-for-review')], previous, () => true)]).toEqual([])
  })

  it('never clears a mark on a host that is not on screen', () => {
    // A hidden store still has an active chat; the watching test is false for every chat of that host.
    const hiddenHostWatching = (_taskId: string) => false
    const previous = new Map<string, TaskStatus>([['a', 'ready-for-review']])
    const current = new Set(['a'])
    expect([...statusUnread(current, [task('a', 'ready-for-review')], previous, hiddenHostWatching)]).toEqual(['a'])
  })

  it('drops marks for chats that no longer exist', () => {
    expect([...statusUnread(new Set(['gone']), [], new Map(), () => false)]).toEqual([])
  })

  it('follows the host inbox both ways', () => {
    const first = inboxUnread(new Set(), new Set(['a', 'b']), new Set())
    expect([...first].sort()).toEqual(['a', 'b'])
    expect([...inboxUnread(first, new Set(['b']), new Set(['a', 'b']))]).toEqual(['b'])
  })

  it('stores each host’s marks under its own key and keeps the same set when nothing changed', () => {
    const base = memory()
    const local = hostStore(base, 'local'),
      studio = hostStore(base, 'studio')
    const current = loadUnread(local)
    const next = commitUnread(local, current, new Set(['a']))
    expect(base.getItem('host:local:ramu.unread')).toBe('["a"]')
    expect([...loadUnread(studio)]).toEqual([])
    expect(commitUnread(local, next, new Set(['a']))).toBe(next)
  })
})
