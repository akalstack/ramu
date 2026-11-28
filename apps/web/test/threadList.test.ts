import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'
import { listedThreadIds, sectionRows } from '../src/sidebar/projects/ThreadList'

const task = (id: string) => ({ id }) as Task

afterEach(() => vi.unstubAllGlobals())

it('puts each identity heading above its threads, and names every thread for range selection', () => {
  const rows = sectionRows(
    [
      { key: 'work', heading: 'Work', items: [task('a'), task('b')] },
      { key: 'home', heading: 'Home', items: [task('c')] },
    ],
    (entry) => entry.id,
  )
  expect(rows.map((row) => row.key)).toEqual(['identity:work', 'a', 'b', 'identity:home', 'c'])
  expect(rows.map((row) => ('taskId' in row ? row.taskId : null))).toEqual([null, 'a', 'b', null, 'c'])
  expect(sectionRows([{ key: 'all', heading: null, items: [task('a')] }], (entry) => entry.id)).toHaveLength(1)
})

/** A stand-in for a sidebar element: a long list names its threads; a row outside one names itself. */
const element = (data: { taskRows?: string; taskId?: string }, inList = false) => ({
  dataset: data,
  parentElement: { closest: () => (inList ? {} : null) },
})

it('orders range selection over every listed thread, including rows a long list has not drawn', () => {
  const found = [
    element({ taskId: 'pinned' }),
    element({ taskRows: JSON.stringify(['a', 'b', 'c']) }),
    // A drawn row of that list is already counted by the list.
    element({ taskId: 'b' }, true),
    element({ taskId: 'loose' }),
    element({ taskRows: JSON.stringify(['loose', 'd']) }),
  ]
  vi.stubGlobal('document', { querySelectorAll: () => found })
  expect(listedThreadIds()).toEqual(['pinned', 'a', 'b', 'c', 'loose', 'd'])
})
