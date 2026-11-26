import { expect, it } from 'vitest'
import type { ChangeFile, ChangeReview } from '@ramu/shared/types'
import type { HandlerContext } from '../src/ipc/types'
import { registerReviewHandlers } from '../src/ipc/handlers/reviews'

const file = (id: string): ChangeFile => ({
  id,
  repoId: 'repo',
  repoName: 'ramu',
  path: `src/${id}.ts`,
  status: 'modified',
  binary: false,
  oldContent: 'x'.repeat(100_000),
  newContent: 'y'.repeat(100_000),
})

it('lists reviews without file contents, including changes another writer made', async () => {
  const review = { id: 'r1', files: [file('mine')], elsewhere: [{ taskId: 't2', files: [file('theirs')] }] }
  const methods = registerReviewHandlers({
    reviews: { list: () => [review as unknown as ChangeReview] },
  } as unknown as HandlerContext)
  const [listed] = (await methods['reviews.list']!.run()) as ChangeReview[]
  expect(listed!.files[0]).toMatchObject({ id: 'mine', path: 'src/mine.ts', oldContent: '', newContent: '' })
  expect(listed!.elsewhere![0]!.files[0]).toMatchObject({ id: 'theirs', oldContent: '', newContent: '' })
  expect(JSON.stringify(listed).length).toBeLessThan(2_000)
})
