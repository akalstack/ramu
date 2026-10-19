import { describe, expect, it } from 'vitest'
import { hostStore, isPerHostKey, migrateLegacyHostKeys, type Store } from '../src/hostStorage'

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  const store: Store & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
  return store
}

describe('hostStore', () => {
  it("keeps each host's keys apart and enumerates only its own", () => {
    const base = memory()
    const local = hostStore(base, 'local')
    const studio = hostStore(base, 'studio')
    local.setItem('ramu.unread', '["a"]')
    studio.setItem('ramu.unread', '["b"]')
    studio.setItem('ramu.draft.chat:1', 'x')
    expect(local.getItem('ramu.unread')).toBe('["a"]')
    expect(studio.getItem('ramu.unread')).toBe('["b"]')
    expect(local.length).toBe(1)
    expect(studio.length).toBe(2)
    expect(Array.from({ length: studio.length }, (_, i) => studio.key(i)).sort()).toEqual([
      'ramu.draft.chat:1',
      'ramu.unread',
    ])
    studio.removeItem('ramu.unread')
    expect(local.getItem('ramu.unread')).toBe('["a"]')
    expect(studio.getItem('ramu.unread')).toBeNull()
  })
})

describe('isPerHostKey', () => {
  it('treats id-keyed state as per host and panel sizes as device-wide', () => {
    for (const key of [
      'ramu.unread',
      'ramu.workspace.resume',
      'ramu.outbox',
      'ramu.navigation-locations',
      'ramu.draft.chat:abc',
      'ramu.last-action:p1',
      'ramu.review-viewed:r1',
      'ramu.layout.chat.task-1',
      'ramu.layout.editor-side.task-1',
      'ramu.layout.workspace-v2.task-1',
    ])
      expect(isPerHostKey(key), key).toBe(true)
    for (const key of [
      'ramu.layout.tools-rail',
      'ramu.layout.react-resizable-panels:scm:repos,git',
      'ramu.review-tree',
      'ramu.review-layout',
      'ramu.search-view',
      'ramu.word-wrap',
      'ramu.recent-commands',
      'ramu.inbox-tab',
      'ramu.last-visit',
      'host:local:ramu.unread',
    ])
      expect(isPerHostKey(key), key).toBe(false)
  })
})

describe('migrateLegacyHostKeys', () => {
  it("moves per-host keys to the window's host and leaves device-wide ones alone", () => {
    const base = memory({
      'ramu.unread': '["a"]',
      'ramu.draft.chat:1': '{"text":"hi","at":1}',
      'ramu.layout.chat.t1': 'hidden',
      'ramu.layout.tools-rail': '300',
      'ramu.search-view': 'list',
      unrelated: '1',
    })
    expect(migrateLegacyHostKeys(base, 'studio')).toBe(3)
    const studio = hostStore(base, 'studio')
    expect(studio.getItem('ramu.unread')).toBe('["a"]')
    expect(studio.getItem('ramu.draft.chat:1')).toBe('{"text":"hi","at":1}')
    expect(studio.getItem('ramu.layout.chat.t1')).toBe('hidden')
    expect(base.getItem('ramu.unread')).toBeNull()
    expect(base.getItem('ramu.layout.tools-rail')).toBe('300')
    expect(base.getItem('ramu.search-view')).toBe('list')
    expect(base.getItem('unrelated')).toBe('1')
  })

  it('runs once, so keys written afterwards are not moved again', () => {
    const base = memory({ 'ramu.unread': '["a"]' })
    migrateLegacyHostKeys(base, 'local')
    base.setItem('ramu.unread', '["late"]')
    expect(migrateLegacyHostKeys(base, 'local')).toBe(0)
    expect(base.getItem('ramu.unread')).toBe('["late"]')
    expect(hostStore(base, 'local').getItem('ramu.unread')).toBe('["a"]')
  })

  it('never overwrites a key that is already namespaced', () => {
    const base = memory({ 'ramu.unread': '["old"]', 'host:local:ramu.unread': '["new"]' })
    migrateLegacyHostKeys(base, 'local')
    expect(hostStore(base, 'local').getItem('ramu.unread')).toBe('["new"]')
    expect(base.getItem('ramu.unread')).toBeNull()
  })

  it('gives a single-host user the same values before and after', () => {
    const before = { 'ramu.unread': '["a","b"]', 'ramu.workspace.resume': '{"x":1}', 'ramu.outbox': '[]' }
    const base = memory(before)
    migrateLegacyHostKeys(base, 'local')
    const local = hostStore(base, 'local')
    for (const [key, value] of Object.entries(before)) expect(local.getItem(key)).toBe(value)
  })
})
