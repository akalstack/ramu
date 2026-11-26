import { expect, it } from 'vitest'
import { foldRepeats } from '../src/chat/repeats'

type Row = { id: string; text: string; repeats?: number; hidden?: boolean }
const fold = (rows: Row[]) =>
  foldRepeats(
    rows,
    (row) => (row.text === 'answer' ? null : row.text),
    (row, repeats) => ({ ...row, repeats }),
    (row) => row.hidden === true,
  )

it('keeps the first of a run, counting the rest', () => {
  expect(
    fold([
      { id: 'a', text: 'Overloaded' },
      { id: 'b', text: 'Overloaded' },
      { id: 'c', text: 'Overloaded' },
      { id: 'd', text: 'Restarted' },
    ]),
  ).toEqual([
    { id: 'a', text: 'Overloaded', repeats: 3 },
    { id: 'd', text: 'Restarted' },
  ])
})

it('never folds items without a key, and anything shown between breaks a run', () => {
  const rows = [
    { id: 'a', text: 'answer' },
    { id: 'b', text: 'answer' },
    { id: 'c', text: 'Overloaded' },
    { id: 'd', text: 'answer' },
    { id: 'e', text: 'Overloaded' },
  ]
  expect(fold(rows)).toEqual(rows)
})

it('lets bookkeeping that draws nothing sit inside a run without splitting it', () => {
  expect(
    fold([
      { id: 'a', text: 'Overloaded' },
      { id: 'end', text: '', hidden: true },
      { id: 'b', text: 'Overloaded' },
    ]),
  ).toEqual([
    { id: 'a', text: 'Overloaded', repeats: 2 },
    { id: 'end', text: '', hidden: true },
  ])
})
