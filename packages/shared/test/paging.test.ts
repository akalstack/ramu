import { expect, it } from 'vitest'
import { appendPage, mergedPages } from '../src/paging'

const newest = (a: number, b: number) => b - a

it('adds a page below what is shown, keeping a row that moved where it first showed', () => {
  expect(appendPage([5, 4, 3], [3, 2, 1], String)).toEqual([5, 4, 3, 2, 1])
})

it('merges hosts in order and holds back rows past where a host with more has loaded', () => {
  // The first host has more after 7, so the second host's 6 and 2 wait until the first one's next page arrives.
  const merged = mergedPages(
    [
      { items: [10, 7], next: 'more' },
      { items: [9, 8, 6, 2], next: null },
    ],
    newest,
  )
  expect(merged).toEqual([10, 9, 8, 7])
  expect(
    mergedPages(
      [
        { items: [3, 1], next: null },
        { items: [2], next: null },
      ],
      newest,
    ),
  ).toEqual([3, 2, 1])
})
