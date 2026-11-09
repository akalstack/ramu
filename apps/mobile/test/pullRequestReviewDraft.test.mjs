import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readReviewDraft, reviewDraftKey, writeReviewDraft } from '../src/runtime/pullRequestReviewDraft.ts'

test('an unsent review survives leaving the pull request, per host and pull request', () => {
  const comments = [{ id: 'a', path: 'src/app.ts', line: 4, body: 'Rename this' }]
  assert.deepEqual(readReviewDraft(writeReviewDraft(comments)), comments)
  assert.notEqual(reviewDraftKey('a', 'https://x/pull/1'), reviewDraftKey('b', 'https://x/pull/1'))
})

test('an empty review clears its draft, and an unreadable one reads as none', () => {
  assert.equal(writeReviewDraft([]), '')
  assert.deepEqual(readReviewDraft(''), [])
  assert.deepEqual(readReviewDraft('{broken'), [])
  assert.deepEqual(readReviewDraft(JSON.stringify([{ id: 'a', path: 'x', line: 'one', body: 'b' }])), [])
})

test('a comment on a block of lines keeps where it starts, and drafts written before ranges still read', () => {
  const ranged = [{ id: 'a', path: 'src/app.ts', line: 18, startLine: 12, body: 'Split this' }]
  assert.deepEqual(readReviewDraft(writeReviewDraft(ranged)), ranged)
  const older = JSON.stringify([{ id: 'b', path: 'src/app.ts', line: 4, body: 'Rename' }])
  assert.equal(readReviewDraft(older)[0].startLine, undefined)
  assert.deepEqual(readReviewDraft(JSON.stringify([{ ...ranged[0], startLine: 'twelve' }])), [])
})
