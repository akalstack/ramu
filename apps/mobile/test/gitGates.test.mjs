import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitBlock, gitGates, startingAction } from '../src/runtime/gitGates.ts'

const clean = {
  oid: 'a'.repeat(40),
  branch: 'feature',
  detached: false,
  upstream: 'origin/feature',
  ahead: 1,
  behind: 0,
  remote: true,
  entries: [],
}
const dirty = { ...clean, entries: [{ path: 'a.ts', staged: null, unstaged: 'modified' }] }
const conflicted = { ...clean, entries: [{ path: 'a.ts', staged: 'unmerged', unstaged: 'unmerged' }] }

test('undo is refused for the root commit, pushed commits, detached heads and unfinished operations', () => {
  assert.equal(gitGates(clean, 3).canUndo, true)
  assert.equal(gitGates(clean, 1).canUndo, false)
  assert.equal(gitGates({ ...clean, ahead: 0 }, 3).canUndo, false)
  assert.equal(gitGates({ ...clean, upstream: null, ahead: 0 }, 3).canUndo, true)
  assert.equal(gitGates({ ...clean, detached: true }, 3).canUndo, false)
  assert.equal(gitGates({ ...clean, operation: 'rebase' }, 3).canUndo, false)
  assert.equal(gitGates(conflicted, 3).canUndo, false)
})

test('remote actions need a branch, a remote and no rebase or merge in progress', () => {
  assert.equal(gitGates(clean, 2).canRemote, true)
  assert.equal(gitGates({ ...clean, remote: false }, 2).canRemote, false)
  assert.equal(gitGates({ ...clean, branch: null }, 2).canRemote, false)
  assert.equal(gitGates({ ...clean, operation: 'merge' }, 2).canRemote, false)
})

test('a clean branch with something to sync or publish turns the primary action into sync', () => {
  assert.equal(gitGates(clean, 2).syncOnly, true)
  assert.equal(gitGates({ ...clean, ahead: 0 }, 2).syncOnly, false)
  assert.equal(gitGates({ ...clean, ahead: 0, behind: 2 }, 2).syncOnly, true)
  assert.equal(gitGates({ ...clean, upstream: null, ahead: 0 }, 2).syncOnly, true)
  assert.equal(gitGates(dirty, 2).syncOnly, false)
  assert.equal(gitGates({ ...clean, remote: false }, 2).syncOnly, false)
})

test('commit actions explain why they cannot run', () => {
  const gates = gitGates(dirty, 2)
  assert.equal(commitBlock('commit', gates, 1, true), null)
  assert.equal(commitBlock('commit', gates, 0, true), 'No changes in this checkout.')
  assert.equal(commitBlock('amend', gitGates(clean, 2), 0, true), null)
  assert.equal(commitBlock('amend', gitGates(clean, 0), 0, false), 'There is no commit to amend yet.')
  assert.match(commitBlock('commit', gitGates(conflicted, 2), 1, true), /Resolve conflicts/)
  assert.match(commitBlock('commit', gitGates({ ...dirty, operation: 'rebase' }, 2), 1, true), /rebase or merge/)
  assert.match(commitBlock('push', gitGates({ ...dirty, remote: false }, 2), 1, true), /no remote/)
  assert.equal(commitBlock('push', gates, 1, true), null)
})

test('the saved default action only applies when its remote can be reached', () => {
  assert.equal(startingAction('push', gitGates(dirty, 2)), 'push')
  assert.equal(startingAction('sync', gitGates({ ...dirty, remote: false }, 2)), 'commit')
  assert.equal(startingAction('amend', gitGates(dirty, 2)), 'commit')
  assert.equal(startingAction(undefined, gitGates(dirty, 2)), 'commit')
})
