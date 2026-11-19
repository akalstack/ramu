import { expect, it } from 'vitest'
import { docBlocks, withDocBlocks } from '../src/docBlocks'

const DOC = [
  '## Highlights',
  '',
  'What shipped **this** week.',
  '- First thing',
  '  - Nested thing',
  '1. Numbered',
  '- [ ] Open task',
  '- [x] Done task',
  '> A quote',
  '',
  '| a | b |',
  '| - | - |',
  '```mermaid',
  'flowchart LR',
  '```',
  'Footnote use[^1]',
  '[^1]: The note',
].join('\n')

it('reads headings, paragraphs, items, tasks and quotes, and leaves tables, code and footnote text alone', () => {
  expect(docBlocks(DOC)).toEqual([
    { kind: 'heading', level: 2, text: 'Highlights' },
    { kind: 'paragraph', level: 0, text: 'What shipped **this** week.' },
    { kind: 'item', level: 0, text: 'First thing' },
    { kind: 'item', level: 1, text: 'Nested thing' },
    { kind: 'item', level: 0, text: 'Numbered' },
    { kind: 'task', level: 0, done: false, text: 'Open task' },
    { kind: 'task', level: 0, done: true, text: 'Done task' },
    { kind: 'quote', level: 0, text: 'A quote' },
    { kind: 'paragraph', level: 0, text: 'Footnote use[^1]' },
  ])
})

it('puts edited words and ticks back in their lines, keeping markers and everything else', () => {
  const blocks = docBlocks(DOC).map((block) => ({ text: block.text, done: block.done }))
  blocks[0] = { text: 'Wins', done: undefined }
  blocks[3] = { text: '', done: undefined }
  blocks[5] = { text: 'Open task', done: true }
  blocks[7] = { text: 'Two\nlines', done: undefined }
  const next = withDocBlocks(DOC, blocks)
  expect(next.split('\n').slice(0, 9)).toEqual([
    '## Wins',
    '',
    'What shipped **this** week.',
    '- First thing',
    '  - Nested thing',
    '1. Numbered',
    '- [x] Open task',
    '- [x] Done task',
    '> Two lines',
  ])
  expect(next.split('\n').slice(9)).toEqual(DOC.split('\n').slice(9))
  expect(() => withDocBlocks(DOC, [])).toThrow('changed while you were editing')
})

it('leaves the lines of blocks nobody changed exactly as written', () => {
  const doc = 'Line one  \nline two\n\n- Item\n  More about the item\n\n    indented code\n'
  const blocks = docBlocks(doc)
  expect(withDocBlocks(doc, blocks)).toBe(doc)
  blocks[0] = { ...blocks[0]!, text: 'First line  ' }
  expect(withDocBlocks(doc, blocks)).toBe(doc.replace('Line one  ', 'First line'))
})
