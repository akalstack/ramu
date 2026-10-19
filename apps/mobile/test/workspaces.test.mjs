import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceCreation, createWorkspaceTask, readWorkspaceChoice } from '../src/runtime/workspaces.ts'

const pending = { projectId: 'p', requestId: 'retry-1', title: 'Fix login', checkout: 'worktree', workspaceId: 'w' }

test('a queued existing workspace survives serialization and skips branch generation and planning', async () => {
  const input = workspaceCreation(
    JSON.parse(
      JSON.stringify({ ...pending, branchNaming: { strategy: 'semantic', prompt: 'Fix login' }, branchPrefix: 'new/' }),
    ),
  )
  const calls = []
  await createWorkspaceTask(
    input,
    () => {
      throw Error('must not plan a new checkout')
    },
    async (input, plan) => {
      calls.push({ input, plan })
      return { id: 'task', workspaceId: input.workspaceId }
    },
  )
  assert.equal(calls[0].input.workspaceId, 'w')
  assert.equal(calls[0].input.requestId, 'retry-1')
  assert.equal(calls[0].input.branchNaming, undefined)
  assert.equal(calls[0].input.branchPrefix, undefined)
  assert.equal(calls[0].plan, undefined)
})

test('deleted or unavailable workspaces fail without falling back to a fresh worktree', async () => {
  let creations = 0
  await assert.rejects(
    createWorkspaceTask(
      workspaceCreation(pending),
      () => {
        throw Error('unexpected plan')
      },
      async () => {
        creations++
        throw Error('This isolated workspace is not ready')
      },
    ),
    /not ready/,
  )
  assert.equal(creations, 1)
  assert.throws(() => workspaceCreation({ ...pending, checkout: 'current' }), /requires worktree/)
})

test('new worktrees retain their frozen naming inputs and pass the exact reviewed plan', async () => {
  const intent = { strategy: 'custom', instructions: 'Use ticket/', prompt: 'Fix login' }
  const input = workspaceCreation({ ...pending, workspaceId: undefined, branchNaming: intent })
  const plan = [
    {
      repoId: 'repo',
      repoName: 'repo',
      baseRef: 'main',
      baseOid: 'frozen',
      taskBranch: 'ticket/login',
      path: '/work/login',
    },
  ]
  let created
  await createWorkspaceTask(
    input,
    async () => plan,
    async (...args) => {
      created = args
    },
  )
  assert.equal(created[0].branchNaming, intent)
  assert.equal(created[1], plan)
  await createWorkspaceTask(
    workspaceCreation({ ...pending, workspaceId: undefined, checkout: 'current' }),
    () => {
      throw Error('unexpected plan')
    },
    async (_, plan) => assert.equal(plan, undefined),
  )
})

test('workspace draft sidecars preserve default, manual and reused provenance without trusting corrupt values', () => {
  for (const choice of [
    { mode: null },
    { mode: 'current' },
    { mode: 'worktree' },
    { mode: 'worktree', workspaceId: 'w', name: 'Login' },
  ]) {
    const restored = readWorkspaceChoice(JSON.stringify({ version: 1, ...choice }))
    assert.equal(restored.mode, choice.mode)
    assert.equal(restored.workspaceId, choice.workspaceId)
    assert.equal(restored.name, choice.name)
  }
  for (const text of [
    undefined,
    'oops',
    '{}',
    '{"version":2,"mode":"current"}',
    '{"version":1,"mode":"current","workspaceId":"w"}',
    '{"version":1,"mode":"worktree","workspaceId":5}',
  ])
    assert.deepEqual(readWorkspaceChoice(text), { mode: null })
})
