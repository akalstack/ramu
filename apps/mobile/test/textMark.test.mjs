import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markSource, quoteNeedles } from '../src/runtime/textMark.ts'

test('marks every occurrence of the words, ignoring case', () => {
  assert.equal(markSource('Deploy now. The DEPLOY is live.', ['deploy']), '==Deploy== now. The ==DEPLOY== is live.')
})

test('a needle with spaces matches across a line break in the source', () => {
  assert.equal(markSource('run the\nbuild first', ['the build']), 'run ==the\nbuild== first')
})

test('code, link targets and autolinks stay untouched', () => {
  assert.equal(
    markSource('Open [deploy docs](https://x.dev/deploy) and run `deploy` <https://deploy.dev>', ['deploy']),
    'Open [==deploy== docs](https://x.dev/deploy) and run `deploy` <https://deploy.dev>',
  )
  assert.equal(markSource('```sh\ndeploy\n```\nthen deploy', ['deploy']), '```sh\ndeploy\n```\nthen ==deploy==')
})

test('nothing to mark is null, so the row is lit instead', () => {
  assert.equal(markSource('Only `deploy` in code', ['deploy']), null)
  assert.equal(markSource('Some text', ['   ']), null)
  assert.equal(markSource('Some text', []), null)
})

test('regex characters in the query are plain text', () => {
  assert.equal(markSource('cost is $5 (approx.)', ['$5 (approx.)']), 'cost is ==$5 (approx.)==')
})

test('a quote is looked for line by line, without list and quote marks', () => {
  assert.deepEqual(quoteNeedles('> First point\n- second item\n2. third\n\nok'), [
    'First point',
    'second item',
    'third',
  ])
})
