import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlocks } from '../src/runtime/markdown.ts'
import { grammarFor, highlightLines } from '../src/runtime/highlight.ts'

test('agent Markdown splits into the blocks the phone draws', () => {
  const blocks = parseBlocks(
    [
      '## Plan',
      '',
      'Some **text**',
      'on two lines.',
      '',
      '- one',
      '  - nested',
      '- [x] done',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '> more',
      '',
      '---',
      '',
      '| A | B |',
      '|:--|--:|',
      '| 1 | 2 |',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n'),
  )
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['heading', 'paragraph', 'list', 'quote', 'rule', 'table', 'code'],
  )
  assert.equal(blocks[0].level, 2)
  assert.equal(blocks[1].text, 'Some **text**\non two lines.')
  assert.deepEqual(
    blocks[2].items.map((i) => [i.depth, i.ordered, !!i.task]),
    [
      [0, false, false],
      [1, false, false],
      [0, false, true],
      [0, true, false],
      [0, true, false],
    ],
  )
  assert.equal(blocks[3].text, 'quoted\nmore')
  assert.deepEqual(blocks[5].align, ['left', 'right'])
  assert.deepEqual(blocks[5].rows, [['1', '2']])
  assert.deepEqual(blocks[6], { kind: 'code', source: 'const a = 1', lang: 'ts' })
})

test('a fence still streaming runs to the end of the reply', () => {
  assert.deepEqual(parseBlocks('Look:\n```py\nprint(1)'), [
    { kind: 'paragraph', text: 'Look:' },
    { kind: 'code', source: 'print(1)', lang: 'py' },
  ])
})

test('code is coloured by fence label or file extension, line by line', () => {
  assert.equal(grammarFor('', 'ts'), 'typescript')
  assert.equal(grammarFor('', 'src/app/index.tsx'), 'typescript')
  assert.equal(grammarFor('', 'Dockerfile'), 'dockerfile')
  const lines = highlightLines('const a = "x" // note\nlet b = 2', 'typescript')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].map((t) => t.text).join(''), 'const a = "x" // note')
  assert.ok(lines[0].some((t) => t.text === 'const' && t.scope?.includes('keyword')))
  assert.ok(lines[0].some((t) => t.scope?.includes('string')))
  assert.ok(lines[0].some((t) => t.scope?.includes('comment')))
  assert.equal(highlightLines('plain', undefined), null)
})

test('an image on its own line becomes an image block', () => {
  assert.deepEqual(parseBlocks('Look:\n\n![chart](src/chart.png)\n\nDone'), [
    { kind: 'paragraph', text: 'Look:' },
    { kind: 'image', alt: 'chart', src: 'src/chart.png' },
    { kind: 'paragraph', text: 'Done' },
  ])
})

test('tables with short dividers parse, and a code fence inside a list ends the list', () => {
  assert.deepEqual(
    parseBlocks('| a | b |\n|-|-|\n| 1 | 2 |').map((b) => b.kind),
    ['table'],
  )
  const blocks = parseBlocks('1. step\n```sh\nls\n```\n2. next')
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['list', 'code', 'list'],
  )
  assert.equal(blocks[2].items[0].marker, '2.')
})
