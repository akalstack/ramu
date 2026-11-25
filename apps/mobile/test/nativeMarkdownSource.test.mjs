import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeMarkdownSource, splitCodeFences } from '../src/runtime/nativeMarkdownSource.ts'

test('file and skill references become links the native view can open; code keeps them as written', () => {
  assert.equal(
    nativeMarkdownSource('Open @src/app.ts with $review'),
    'Open [@src/app.ts](ramu-file:src%2Fapp.ts) with [$review](ramu-skill:review)',
  )
  assert.equal(nativeMarkdownSource('Run `@src/app.ts` as is'), 'Run `@src/app.ts` as is')
})

test('a workspace image inside a paragraph stays with the renderer that can fetch it from the host', () => {
  assert.equal(nativeMarkdownSource('See ![shot](screens/a.png) here'), null)
  assert.equal(nativeMarkdownSource('![shot](https://example.com/a.png)'), '![shot](https://example.com/a.png)')
  // Alone on its line it is split out and drawn as its own image, so the native view keeps the rest.
  assert.equal(nativeMarkdownSource('Here:\n\n![shot](screens/a.png)'), 'Here:\n\n![shot](screens/a.png)')
})

test('a file named in backticks becomes a link, but not inside a code block', () => {
  assert.equal(nativeMarkdownSource('Edit `src/app.ts` now'), 'Edit [src/app.ts](ramu-file:src%2Fapp.ts) now')
  assert.equal(nativeMarkdownSource('Run `npm test`'), 'Run `npm test`')
  const fenced = '```\nsee `src/app.ts`\n```'
  assert.equal(nativeMarkdownSource(fenced), fenced)
})

test('closed code fences come out of the text view, so a long line scrolls instead of wrapping', () => {
  assert.deepEqual(splitCodeFences('Run this:\n\n```ts\nconst a = 1\n```\n\nThen done.'), [
    { kind: 'text', source: 'Run this:\n' },
    { kind: 'code', source: 'const a = 1', lang: 'ts' },
    { kind: 'text', source: '\nThen done.' },
  ])
  assert.deepEqual(splitCodeFences('~~~\nplain\n~~~'), [{ kind: 'code', source: 'plain' }])
})

test('a fence still being written stays in the text', () => {
  assert.deepEqual(splitCodeFences('Start\n```js\nlet a'), [{ kind: 'text', source: 'Start\n```js\nlet a' }])
})

test('a fence nested in a list is drawn as a code block, so it gets its file header too', () => {
  assert.deepEqual(splitCodeFences('- step\n  ```sh\n  npm i\n  ```\n- next'), [
    { kind: 'text', source: '- step' },
    { kind: 'code', source: '  npm i', lang: 'sh' },
    { kind: 'text', source: '- next' },
  ])
  // A shorter or different marker does not close a longer fence.
  assert.deepEqual(splitCodeFences('````md\n```\ninner\n```\n````'), [
    { kind: 'code', source: '```\ninner\n```', lang: 'md' },
  ])
})

test('an image alone on its line becomes its own part; one inside a sentence or a fence does not', () => {
  assert.deepEqual(splitCodeFences('Look:\n![The page](shots/home.png "Home")\nDone.'), [
    { kind: 'text', source: 'Look:' },
    { kind: 'image', src: 'shots/home.png', alt: 'The page' },
    { kind: 'text', source: 'Done.' },
  ])
  assert.deepEqual(splitCodeFences('See ![x](a.png) here'), [{ kind: 'text', source: 'See ![x](a.png) here' }])
  assert.deepEqual(splitCodeFences('```md\n![x](a.png)\n```'), [{ kind: 'code', source: '![x](a.png)', lang: 'md' }])
})
