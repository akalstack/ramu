import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readExplorerNavigation, rememberExplorerNavigation } from '../src/runtime/explorerNavigation.ts'

test('restores navigation only for the exact host and checkout without storing file contents', () => {
  const drafts = rememberExplorerNavigation(
    { request: 'Keep this draft' },
    'a',
    'worktree:w',
    { expanded: ['r:src'], offset: 420 },
    1,
  )
  assert.deepEqual(readExplorerNavigation(drafts, 'a', 'worktree:w'), { expanded: ['r:src'], offset: 420, at: 1 })
  assert.equal(readExplorerNavigation(drafts, 'b', 'worktree:w').offset, 0)
  assert.equal(readExplorerNavigation(drafts, 'a', 'project:w').offset, 0)
  assert.equal(drafts.request, 'Keep this draft')
  assert.deepEqual(Object.keys(JSON.parse(Object.values(drafts).find((value) => value.startsWith('{')))).sort(), [
    'at',
    'expanded',
    'offset',
  ])
})
test('bounds old scopes and folder metadata while preserving unrelated drafts', () => {
  let drafts = { request: 'Draft', 'a:new:p': 'Another draft' }
  for (let n = 0; n < 30; n++)
    drafts = rememberExplorerNavigation(
      drafts,
      'a',
      `project:${n}`,
      { expanded: Array.from({ length: 150 }, (_, i) => `r:folder-${i}`), offset: 20_000_000 },
      n,
    )
  assert.equal(Object.keys(drafts).length, 14)
  assert.equal(readExplorerNavigation(drafts, 'a', 'project:0').offset, 0)
  assert.equal(readExplorerNavigation(drafts, 'a', 'project:29').expanded.length, 80)
  assert.equal(readExplorerNavigation(drafts, 'a', 'project:29').offset, 10_000_000)
  assert.equal(drafts.request, 'Draft')
})
test('ignores corrupt metadata and rejects nonfinite scroll positions', () => {
  const drafts = rememberExplorerNavigation(
    {},
    'a',
    'p',
    { expanded: ['r:src', 'r:src', 'bad\u0000path'], offset: -10 },
    1,
  )
  assert.deepEqual(readExplorerNavigation(drafts, 'a', 'p').expanded, ['r:src'])
  assert.equal(readExplorerNavigation(drafts, 'a', 'p').offset, 0)
  const key = Object.keys(drafts)[0]
  assert.equal(readExplorerNavigation({ [key]: '{broken' }, 'a', 'p').offset, 0)
  assert.deepEqual(rememberExplorerNavigation(drafts, 'a', 'p', { expanded: [], offset: Infinity }), drafts)
})
