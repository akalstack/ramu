import { expect, it } from 'vitest'
import { liveActivityContent, liveActivityCountsContent, liveActivityOrder } from '../src/liveActivity'

const base = { startedAt: 1, updatedAt: 2, locale: 'en' as const }

it('puts what needs the person first and counts each state, keeping the legacy fields', () => {
  const content = liveActivityContent(
    [
      { title: 'Refactor  the\nparser', status: 'working' },
      { title: 'Ship docs', status: 'done' },
      { title: 'Deploy', status: 'approval' },
      { title: 'Build', status: 'failed' },
      { title: 'Tests', status: 'working' },
    ],
    base,
  )
  expect(content).toMatchObject({ running: 2, waiting: 1, failed: 1, done: 1, phase: 'waiting', tone: 'attention' })
  expect(content.need).toBe('approval')
  expect(content.rows).toEqual([
    { title: 'Deploy', status: 'approval' },
    { title: 'Build', status: 'failed' },
    { title: 'Refactor the parser', status: 'working' },
  ])
})

it('shows finished work as done or failed, never as zero counts', () => {
  const done = liveActivityContent(
    [
      { title: 'A', status: 'done' },
      { title: 'B', status: 'done' },
    ],
    base,
  )
  expect(done).toMatchObject({ running: 0, waiting: 0, done: 2, phase: 'finished', tone: 'done' })
  expect(done.failed).toBeUndefined()
  expect(liveActivityContent([{ title: 'A', status: 'failed' }], base).tone).toBe('failed')
})

it('clips long titles and orders threads of one state as given', () => {
  const [row] = liveActivityContent([{ title: 'x'.repeat(200), status: 'working' }], base).rows!
  expect(row!.title.length).toBeLessThanOrEqual(48)
  expect(row!.title.endsWith('…')).toBe(true)
  expect(
    liveActivityOrder([
      { status: 'done' as const, n: 1 },
      { status: 'working' as const, n: 2 },
      { status: 'done' as const, n: 3 },
    ]).map((t) => t.n),
  ).toEqual([2, 1, 3])
})

it('gives a host push counts only, with no titles', () => {
  const content = liveActivityCountsContent({ running: 1, needsInput: 2 }, base, false)
  expect(content).toEqual({ running: 1, waiting: 2, ...base, phase: 'waiting', tone: 'attention', need: 'input' })
  expect(liveActivityCountsContent({ running: 1, needsInput: 2 }, base, true)).toEqual({
    running: 0,
    waiting: 0,
    ...base,
    phase: 'finished',
    tone: 'done',
  })
})
