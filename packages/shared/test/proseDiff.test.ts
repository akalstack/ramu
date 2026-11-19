import { expect, it } from 'vitest'
import { proseBlocks, proseDiff, proseSections, wordDiff } from '../src/review/proseDiff'

it('cuts a document into headings, paragraphs, single list items and whole code blocks', () => {
  const blocks = proseBlocks(
    '# Title\nIntro line one\nline two\n\n- first **item**\n- second\n  more\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |',
  )
  expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'item', 'item', 'other', 'other'])
  expect(blocks[0]).toMatchObject({ level: 1, text: 'Title' })
  expect(blocks[1]!.text).toBe('Intro line one line two')
  expect(blocks[2]).toMatchObject({ marker: '-', text: 'first item' })
  expect(blocks[3]!.text).toBe('second more')
  expect(blocks[4]!.source).toContain('const b = 2')
})

it('shows which words of a changed paragraph went and came', () => {
  expect(wordDiff('The quick fox jumps', 'The slow fox leaps')).toEqual([
    { kind: 'same', text: 'The ' },
    { kind: 'del', text: 'quick' },
    { kind: 'ins', text: 'slow' },
    { kind: 'same', text: ' fox ' },
    { kind: 'del', text: 'jumps' },
    { kind: 'ins', text: 'leaps' },
  ])
})

it('pairs a reworded paragraph, keeps unchanged blocks, and shows changed code before then after', () => {
  const entries = proseDiff(
    '# Guide\n\nRun the tests often.\n\n```sh\nnpm test\n```\n\nOld note.',
    '# Guide\n\nRun the tests every time.\n\n```sh\npnpm test\n```\n\n- New item',
  )
  expect(entries.map((entry) => entry.kind)).toEqual(['same', 'changed', 'del', 'ins', 'del', 'ins'])
  const changed = entries[1]!
  expect(changed.kind === 'changed' && changed.words.filter((word) => word.kind === 'ins')).toEqual([
    { kind: 'ins', text: 'every time.' },
  ])
})

it('treats a new or deleted document as wholly added or removed', () => {
  expect(proseDiff('', '# A\n\nB').map((entry) => entry.kind)).toEqual(['ins', 'ins'])
  expect(proseDiff('A\n\nB', '').map((entry) => entry.kind)).toEqual(['del', 'del'])
})

it('folds long unchanged runs but keeps a block of context beside each change', () => {
  const before = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
  const after = before.replace('Paragraph 8.', 'Paragraph eight.')
  const sections = proseSections(proseDiff(before, after))
  expect(sections.map((section) => section.kind)).toEqual(['fold', 'same', 'changed', 'same'])
  expect(sections[0]!.kind === 'fold' && sections[0]!.entries).toHaveLength(7)
})

it('shows a huge rewrite whole instead of comparing every block', () => {
  const before = Array.from({ length: 600 }, (_, i) => `Old ${i} words here.`).join('\n\n')
  const after = Array.from({ length: 600 }, (_, i) => `New ${i} text there.`).join('\n\n')
  const entries = proseDiff(before, after)
  expect(entries.every((entry) => entry.kind !== 'same')).toBe(true)
  expect(entries.filter((entry) => entry.kind !== 'ins')).toHaveLength(600)
})
