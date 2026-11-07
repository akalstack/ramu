import { expect, it } from 'vitest'
import { inlineRuns } from '../src/inlineMarks'

it('splits a line into styled runs that join back into the same Markdown', () => {
  const line = 'Ship **sync** on _Friday_, run `pnpm test` and read [the plan](https://x.dev/p).'
  const runs = inlineRuns(line)
  expect(runs.map((run) => run.text).join('')).toBe(line)
  expect(runs.filter((run) => run.style !== 'plain' && run.style !== 'marker')).toEqual([
    { text: 'sync', style: 'bold' },
    { text: 'Friday', style: 'italic' },
    { text: 'pnpm test', style: 'code' },
    { text: 'the plan', style: 'link' },
  ])
  expect(inlineRuns('2 * 3 * 4 and a_b_c')).toEqual([{ text: '2 * 3 * 4 and a_b_c', style: 'plain' }])
})
