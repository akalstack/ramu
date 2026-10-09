import { describe, expect, it } from 'vitest'
import { reviewCommentOutdated } from '../src/shared/reviewOutdated'
import type { ChangeFile, ReviewComment } from '../src/shared/types'
const file: ChangeFile = { id: 'f', repoId: 'r', repoName: 'Repo', path: 'a.ts', status: 'modified', binary: false, oldContent: 'heading\nold code\nfooter', newContent: 'heading\nnew code\nfooter' }
const comment: ReviewComment = { id: 'c', fileId: 'f', side: 'new', line: 2, endLine: 2, text: 'Check this', author: 'human', state: 'draft', createdAt: 0 }
describe('outdated review anchors', () => {
  it('ignores changed line numbers and changes elsewhere', () => {
    expect(reviewCommentOutdated(file, comment, 'inserted\nheading\nnew code\nnew footer')).toBe(false)
  })
  it('detects edits to a selected line or block', () => {
    expect(reviewCommentOutdated(file, comment, 'heading\nreplacement\nfooter')).toBe(true)
    expect(reviewCommentOutdated(file, { ...comment, endLine: 3 }, 'heading\nnew code\nnew footer')).toBe(true)
  })
  it('does not call recorded deletions or file-level comments outdated', () => {
    expect(reviewCommentOutdated(file, { ...comment, side: 'old' }, file.newContent)).toBe(false)
    expect(reviewCommentOutdated(file, { ...comment, scope: 'file' }, 'replacement')).toBe(false)
  })
  it('checks surviving before-side code too', () => {
    expect(reviewCommentOutdated(file, { ...comment, side: 'old', line: 1, endLine: 1 }, 'new heading\nnew code\nfooter')).toBe(true)
  })
})
