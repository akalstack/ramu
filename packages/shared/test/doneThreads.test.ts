import { describe, expect, it } from 'vitest'
import { doneCursor, listedThreads, olderDoneThreads } from '../src/doneThreads'

const open = (id: string) => ({ id, status: 'idle', doneAt: null })
const done = (id: string, doneAt: number) => ({ id, status: 'idle', doneAt })
const archived = { id: 'gone', status: 'archived', doneAt: 50 }
const tasks = [open('a'), done('d1', 10), done('d2', 30), done('d3', 20), done('d4', 20), archived, open('b')]

describe('finished threads a page at a time', () => {
  it('lists everything when a device asks without options, as older ones do', () => {
    expect(listedThreads(tasks)).toEqual(tasks)
  })

  it('lists open and archived threads, the newest finished ones and those the device holds', () => {
    expect(listedThreads(tasks, { recentDone: 2 }).map((task) => task.id)).toEqual(['a', 'd2', 'd3', 'gone', 'b'])
    expect(listedThreads(tasks, { recentDone: 2, keep: ['d1'] }).map((task) => task.id)).toEqual([
      'a',
      'd1',
      'd2',
      'd3',
      'gone',
      'b',
    ])
  })

  it('pages from the oldest finished thread held, never skipping or repeating one finished at the same moment', () => {
    const held = listedThreads(tasks, { recentDone: 2 })
    const cursor = doneCursor(held)!
    expect(cursor).toEqual({ doneAt: 20, id: 'd3' })
    const first = olderDoneThreads(tasks, cursor, 1)
    expect(first.page.map((task) => task.id)).toEqual(['d4'])
    expect(first.remaining).toBe(1)
    const second = olderDoneThreads(tasks, doneCursor([...held, ...first.page])!, 25)
    expect(second.page.map((task) => task.id)).toEqual(['d1'])
    expect(second.remaining).toBe(0)
  })

  it('counts what is left without reading it', () => {
    expect(olderDoneThreads(tasks, { doneAt: 30, id: 'd2' }, 0)).toEqual({ page: [], remaining: 3 })
    expect(doneCursor([open('a')])).toBeNull()
  })
})
