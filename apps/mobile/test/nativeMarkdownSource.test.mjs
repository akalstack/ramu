import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownBlocks, nativeMarkdownSource, splitCodeFences } from '../src/runtime/nativeMarkdownSource.ts'

test('file and skill references become links the native view can open; code keeps them as written', () => {
  assert.equal(
    nativeMarkdownSource('Open @src/app.ts with $review'),
    'Open [@src/app.ts](ramu-file:src%2Fapp.ts) with [$review](ramu-skill:review)',
  )
  assert.equal(nativeMarkdownSource('Run `@src/app.ts` as is'), 'Run `@src/app.ts` as is')
})

test('a workspace image stays with the renderer that can fetch it from the host', () => {
  assert.equal(nativeMarkdownSource('![shot](screens/a.png)'), null)
  assert.equal(nativeMarkdownSource('![shot](https://example.com/a.png)'), '![shot](https://example.com/a.png)')
})

test('a file named in backticks becomes a link, but not inside a code block', () => {
  assert.equal(nativeMarkdownSource('Edit `src/app.ts` now'), 'Edit [src/app.ts](ramu-file:src%2Fapp.ts) now')
  assert.equal(nativeMarkdownSource('Run `npm test`'), 'Run `npm test`')
  const fenced = '```\nsee `src/app.ts`\n```'
  assert.equal(nativeMarkdownSource(fenced), fenced)
})

test('a reply splits into its top-level blocks for fading in one at a time', () => {
  assert.deepEqual(markdownBlocks('# Plan\n\nFirst paragraph\nstill first.\n\nSecond.'), [
    '# Plan',
    'First paragraph\nstill first.',
    'Second.',
  ])
  // A fence keeps its blank lines; a loose list and an indented continuation stay one block.
  assert.deepEqual(markdownBlocks('```ts\na()\n\nb()\n```\n\n1. one\n\n2. two\n\n   more of two\n\nAfter.'), [
    '```ts\na()\n\nb()\n```',
    '1. one\n\n2. two\n\n   more of two',
    'After.',
  ])
  // A fence still arriving keeps everything after it.
  assert.deepEqual(markdownBlocks('Intro\n\n```\ncode\n\nmore'), ['Intro', '```\ncode\n\nmore'])
  assert.deepEqual(markdownBlocks('\n\n'), [])
})

test('closed code fences come out of the text view, so a long line scrolls instead of wrapping', () => {
  assert.deepEqual(splitCodeFences('Run this:\n\n```ts\nconst a = 1\n```\n\nThen done.'), [
    { kind: 'text', source: 'Run this:\n' },
    { kind: 'code', source: 'const a = 1', lang: 'ts' },
    { kind: 'text', source: '\nThen done.' },
  ])
  assert.deepEqual(splitCodeFences('~~~\nplain\n~~~'), [{ kind: 'code', source: 'plain' }])
})

test('a fence still being written, or one nested in a list, stays in the text', () => {
  assert.deepEqual(splitCodeFences('Start\n```js\nlet a'), [{ kind: 'text', source: 'Start\n```js\nlet a' }])
  const nested = '- step\n  ```sh\n  npm i\n  ```'
  assert.deepEqual(splitCodeFences(nested), [{ kind: 'text', source: nested }])
})
