import { expect, it } from 'vitest'
import { replyPreview } from '../src/chat/replyPreview'

it('reads a Markdown reply as one plain line', () => {
  expect(
    replyPreview(
      '## Done\n\nI fixed **the login bug** in [auth.ts](src/auth.ts) and added a test.\n\n- `pnpm test` passes\n',
    ),
  ).toBe('Done I fixed the login bug in auth.ts and added a test. pnpm test passes')
})

it('leaves out code blocks, tables, images and tags', () => {
  expect(
    replyPreview('Here is the plan:\n```ts\nconst x = 1\n```\n| a | b |\n|---|---|\n![shot](a.png) <br> Ship it.'),
  ).toBe('Here is the plan: Ship it.')
  expect(replyPreview('```\nonly code\n```')).toBe('')
})

it('keeps snake_case and arithmetic, and cuts a long reply at a word', () => {
  expect(replyPreview('Renamed user_id to account_id; 2 * 3 * 4 = 24.')).toBe(
    'Renamed user_id to account_id; 2 * 3 * 4 = 24.',
  )
  const long = replyPreview(`${'word '.repeat(60)}end`)
  expect(long.endsWith('word…')).toBe(true)
  expect(long.length).toBeLessThanOrEqual(161)
})
