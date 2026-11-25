import { expect, it } from 'vitest'
import { markdownBlocks } from '../src/chat/markdownBlocks'

it('splits a reply into its top-level blocks', () => {
  expect(markdownBlocks('# Plan\n\nFirst paragraph\nstill first.\n\nSecond.')).toEqual([
    '# Plan',
    'First paragraph\nstill first.',
    'Second.',
  ])
  expect(markdownBlocks('\n\n')).toEqual([])
})

it('keeps blank lines inside a fence, and a loose list or indented continuation as one block', () => {
  expect(markdownBlocks('```ts\na()\n\nb()\n```\n\n1. one\n\n2. two\n\n   more of two\n\nAfter.')).toEqual([
    '```ts\na()\n\nb()\n```',
    '1. one\n\n2. two\n\n   more of two',
    'After.',
  ])
  // A fence still arriving keeps everything after it.
  expect(markdownBlocks('Intro\n\n```\ncode\n\nmore')).toEqual(['Intro', '```\ncode\n\nmore'])
})

it('keeps text whole when its meaning crosses blank lines', () => {
  const reference = 'See [the docs][d].\n\n[d]: https://example.com'
  expect(markdownBlocks(reference)).toEqual([reference])
  const html = '<details>\n\nHidden\n\n</details>'
  expect(markdownBlocks(html)).toEqual([html])
  const math = '$$\na\n\nb\n$$'
  expect(markdownBlocks(math)).toEqual([math])
})
