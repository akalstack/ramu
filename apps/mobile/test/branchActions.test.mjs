import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  branchActionBlock,
  branchOptionBlock,
  deletableBranches,
  runBranchAction,
} from '../src/runtime/branchActions.ts'

const branches = [
  { name: 'main', current: false, worktree: '' },
  { name: 'feature', current: true, worktree: '/repo' },
  { name: 'merged', current: false, worktree: '' },
  { name: 'elsewhere', current: false, worktree: '/repo-worktree' },
]
const context = { canWrite: true, status: { branch: 'feature', entries: [] }, branches }
const target = { computerId: 'pc', taskId: 'task', repoId: 'repo' }

function host(answer = () => undefined) {
  const calls = []
  const invoke = async (computer, method, ...args) => {
    assert.equal(computer, 'pc')
    calls.push([method, ...args])
    return answer(method)
  }
  return { calls, invoke }
}

test('each branch action calls its host method with the task, repository and names', async () => {
  const actions = [
    [{ kind: 'merge', name: 'main' }, ['git.mergeBranch', 'task', 'repo', 'main']],
    [{ kind: 'create-from', name: 'fix', from: 'main' }, ['git.createBranchFrom', 'task', 'repo', 'fix', 'main']],
    [{ kind: 'rename', name: 'feature-2' }, ['git.renameBranch', 'task', 'repo', 'feature-2']],
    [{ kind: 'delete', name: 'merged' }, ['git.deleteBranch', 'task', 'repo', 'merged']],
  ]
  for (const [action, call] of actions) {
    const { calls, invoke } = host()
    assert.deepEqual(await runBranchAction(invoke, target, action), { conflicts: [] })
    assert.deepEqual(calls, [call])
  }
})

test('a merge that stops on conflicts returns the conflicted files instead of failing', async () => {
  const { calls, invoke } = host((method) => {
    if (method === 'git.mergeBranch') throw new Error('Merge stopped on conflicts.')
    return {
      operation: 'merge',
      entries: [
        { path: 'a.ts', staged: 'unmerged', unstaged: 'unmerged' },
        { path: 'clean.ts', staged: 'modified', unstaged: null },
        { path: 'b.ts', staged: null, unstaged: 'unmerged' },
      ],
    }
  })
  assert.deepEqual(await runBranchAction(invoke, target, { kind: 'merge', name: 'main' }), {
    conflicts: ['a.ts', 'b.ts'],
  })
  assert.deepEqual(calls.at(-1), ['git.status', 'task', 'repo'])
})

test('a merge that fails without leaving a merge in progress reports the failure', async () => {
  const { invoke } = host((method) => {
    if (method === 'git.mergeBranch') throw new Error('Commit or stash your working changes')
    return { operation: null, entries: [] }
  })
  await assert.rejects(runBranchAction(invoke, target, { kind: 'merge', name: 'main' }), /Commit or stash/)
})

test('the checked-out branch, and one checked out in another worktree, cannot be deleted', () => {
  assert.deepEqual(
    deletableBranches(context).map((branch) => branch.name),
    ['main', 'merged'],
  )
  assert.equal(
    branchActionBlock({ kind: 'delete', name: 'feature' }, context),
    'Switch to another branch before deleting this one.',
  )
  assert.equal(
    branchActionBlock({ kind: 'delete', name: 'elsewhere' }, context),
    'This branch is checked out in another worktree.',
  )
  assert.equal(branchActionBlock({ kind: 'delete', name: 'merged' }, context), null)
  const only = { ...context, branches: [branches[1]] }
  assert.equal(branchOptionBlock('delete', only), 'There is no other branch to delete.')
})

test('a view-only device can open no branch action', () => {
  const viewer = { ...context, canWrite: false }
  for (const kind of ['merge', 'create-from', 'rename', 'delete'])
    assert.equal(branchOptionBlock(kind, viewer), 'This device is view-only, so it cannot change branches.')
  assert.match(branchActionBlock({ kind: 'merge', name: 'main' }, viewer), /view-only/)
})

test('merging and starting a branch need a clean checkout, as the host requires', () => {
  const dirty = { ...context, status: { branch: 'feature', entries: [{ path: 'a.ts' }] } }
  assert.equal(branchOptionBlock('merge', dirty), 'Commit or stash your changes first.')
  assert.equal(branchOptionBlock('create-from', dirty), 'Commit or stash your changes first.')
  assert.equal(branchOptionBlock('rename', dirty), null)
  assert.equal(
    branchActionBlock({ kind: 'merge', name: 'feature' }, context),
    'Choose a different branch to merge into this one.',
  )
  const merging = { ...context, status: { branch: 'feature', entries: [], operation: 'merge' } }
  assert.equal(branchOptionBlock('merge', merging), 'Finish the rebase or merge in progress first.')
})

test('a new or renamed branch needs a valid name no branch has yet', () => {
  assert.equal(branchActionBlock({ kind: 'rename', name: 'main' }, context), 'A branch with this name already exists.')
  assert.match(branchActionBlock({ kind: 'rename', name: 'has space' }, context), /without spaces/)
  assert.equal(branchActionBlock({ kind: 'rename', name: 'feature-2' }, context), null)
  assert.equal(
    branchActionBlock({ kind: 'create-from', name: 'fix', from: 'gone' }, context),
    'Select an existing local branch to start from.',
  )
  assert.equal(branchActionBlock({ kind: 'create-from', name: 'fix', from: 'main' }, context), null)
  const detached = { ...context, status: { branch: null, entries: [] } }
  assert.equal(branchOptionBlock('rename', detached), 'Switch to a branch before renaming it.')
})
