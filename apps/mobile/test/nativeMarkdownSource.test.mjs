import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeMarkdownSource } from '../src/runtime/nativeMarkdownSource.ts'

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
