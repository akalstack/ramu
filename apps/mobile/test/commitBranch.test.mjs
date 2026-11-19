import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitBranchOptions, commitBranchQuestion } from '../src/runtime/commitBranch.ts'

const onMain = { branch: 'main', defaultBranch: 'main' }

test('pushing or syncing a commit on the default branch asks first, led by the host setting', () => {
  assert.deepEqual(commitBranchQuestion('push', onMain, 'new-branch'), { branch: 'main', first: 'new' })
  assert.deepEqual(commitBranchQuestion('sync', onMain, 'current'), { branch: 'main', first: 'current' })
  // Before the host's settings arrive, a feature branch is the safer first choice.
  assert.deepEqual(commitBranchQuestion('push', onMain, undefined), { branch: 'main', first: 'new' })
})

test('a plain commit, another branch or a detached head goes ahead without asking', () => {
  assert.equal(commitBranchQuestion('commit', onMain, 'new-branch'), null)
  assert.equal(commitBranchQuestion('push', { branch: 'feature', defaultBranch: 'main' }, 'new-branch'), null)
  assert.equal(commitBranchQuestion('push', { branch: null, defaultBranch: 'main' }, 'new-branch'), null)
  assert.equal(commitBranchQuestion('push', { branch: 'main', defaultBranch: null }, 'new-branch'), null)
})

test('the choice becomes the commit branch options the host checks', () => {
  assert.deepEqual(commitBranchOptions('main', 'new'), { expectedBranch: 'main', autoBranch: true })
  assert.deepEqual(commitBranchOptions('main', 'current'), { expectedBranch: 'main' })
})
