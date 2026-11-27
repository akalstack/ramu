import { afterEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { InteractiveStore } from '../src/interactive/store'
import { PageStore } from '../src/interactive/pages'

const databases: Db[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function setup() {
  const db = openDb(':memory:')
  databases.push(db)
  const interactive = new InteractiveStore(db, vi.fn(), vi.fn())
  const insert = db.prepare(
    'INSERT INTO artifacts (id,kind,data,current_version,pinned,created_at,changed_at) VALUES (?,?,?,1,?,0,?)',
  )
  const add = (id: string, kind: string, title: string, changed: number, pinned = 0) =>
    insert.run(
      id,
      kind,
      JSON.stringify({ title, icon: '', projectId: null, sessionId: 's', capabilities: {}, grants: {} }),
      pinned,
      changed,
    )
  return { pages: new PageStore(db, interactive), add }
}

it('pages artifacts pinned first then newest, past the old list’s cap, without repeating or skipping one', () => {
  const { pages, add } = setup()
  for (let index = 0; index < 520; index++) add(`a${String(index).padStart(3, '0')}`, 'doc', `Note ${index}`, index % 7)
  add('pinned', 'doc', 'Pinned', 0, 1)
  const seen: string[] = []
  let cursor: string | null = null
  do {
    const page = pages.page({}, cursor, 100)
    seen.push(...page.items.map((item) => item.id))
    cursor = page.next
  } while (cursor)
  expect(seen).toHaveLength(521)
  expect(new Set(seen).size).toBe(521)
  expect(seen[0]).toBe('pinned')
  expect(pages.list()).toHaveLength(500)
})

it('applies the search and kind on the host and lists every kind for the filter', () => {
  const { pages, add } = setup()
  add('d1', 'doc', 'Launch plan', 3)
  add('d2', 'doc', 'Budget', 2)
  add('s1', 'slides', 'Launch deck', 1)
  add('x1', 'future-kind', 'Launch tool', 0)
  const launch = pages.page({ query: 'LAUNCH' }, null, 10)
  expect(launch.items.map((item) => item.id)).toEqual(['d1', 's1', 'x1'])
  expect(launch.next).toBeNull()
  expect(pages.page({ kind: 'doc' }, null, 10).items.map((item) => item.id)).toEqual(['d1', 'd2'])
  // An unknown kind opens as an app, so the App filter finds it.
  expect(pages.page({ kind: 'app' }, null, 10).items.map((item) => item.id)).toEqual(['x1'])
  expect(launch.kinds.sort()).toEqual(['app', 'doc', 'slides'])
})
