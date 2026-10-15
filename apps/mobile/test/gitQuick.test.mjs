import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitAndPush } from '../src/runtime/gitQuick.ts'

const chat = { computerId: 'pc', taskId: 'task', provider: 'codex', model: 'model' }
const mixed = [
  { path: 'mixed.txt', staged: 'modified', unstaged: 'modified' },
  { path: 'staged.txt', staged: 'added', unstaged: null },
  { path: 'new.txt', staged: null, unstaged: 'untracked' },
]
function host(combineGitChanges, entries = mixed) {
  const calls = []
  const invoke = async (computer, method, ...args) => {
    assert.equal(computer, 'pc')
    calls.push([method, ...args])
    if (method === 'git.status') return { entries }
    if (method === 'settings.app.get') return { combineGitChanges }
    if (method === 'git.generateCommit') return { message: 'All edits', fingerprint: 'fingerprint' }
  }
  return { calls, invoke }
}

test('combined mobile quick commit stages remaining edits even with files already staged', async () => {
  const { calls, invoke } = host(true)
  await commitAndPush(invoke, chat, 'repo')
  assert.deepEqual(
    calls.find(([method]) => method === 'git.stage'),
    ['git.stage', 'task', 'repo', ['mixed.txt', 'new.txt']],
  )
  const operations = calls.map(([method]) => method)
  assert.ok(operations.indexOf('git.stage') < operations.indexOf('git.generateCommit'))
  assert.ok(operations.indexOf('git.generateCommit') < operations.indexOf('git.commit'))
  assert.ok(operations.indexOf('git.commit') < operations.indexOf('git.push'))
})

test('split mobile quick commit preserves unstaged edits when the index has changes', async () => {
  const { calls, invoke } = host(false)
  await commitAndPush(invoke, chat, 'repo')
  assert.equal(
    calls.some(([method]) => method === 'git.stage'),
    false,
  )
  assert.deepEqual(
    calls.find(([method]) => method === 'git.commit'),
    ['git.commit', 'task', 'repo', 'All edits', 'fingerprint'],
  )
})

test('split mobile quick commit stages everything if nothing is staged', async () => {
  const { calls, invoke } = host(false, [mixed[2]])
  await commitAndPush(invoke, chat, 'repo')
  assert.deepEqual(
    calls.find(([method]) => method === 'git.stage'),
    ['git.stage', 'task', 'repo', ['new.txt']],
  )
})

test('mobile quick commit does not auto-stage unresolved conflicts', async () => {
  const { calls, invoke } = host(true, [{ path: 'conflict.txt', staged: 'unmerged', unstaged: 'unmerged' }])
  await assert.rejects(commitAndPush(invoke, chat, 'repo'), /Resolve conflicts/)
  assert.equal(
    calls.some(([method]) => method === 'git.stage' || method === 'git.commit'),
    false,
  )
})
