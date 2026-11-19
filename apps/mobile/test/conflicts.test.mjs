import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indonesian } from '../../../packages/shared/src/locales/id.ts'
import {
  ALL_FILES_LABEL,
  ALL_FILES_TITLE,
  CHOICE_LABEL,
  conflictPrompt,
  startConflictThread,
} from '../src/runtime/conflicts.ts'

const work = { repoName: 'ramu', cwd: '/src/ramu', kind: 'merge', paths: ['a.ts', 'b.ts'], whole: true }

test('the prompt names the repository, the files and what the agent must not do', () => {
  const prompt = conflictPrompt(work)
  assert.match(prompt, /^Resolve 2 merge conflicts in ramu\./)
  assert.match(prompt, /Repository: ramu \(\/src\/ramu\)/)
  assert.match(prompt, /Conflicted files:\n- a\.ts\n- b\.ts/)
  assert.match(prompt, /Do not commit, continue, abort or skip the merge, and do not push\./)
})

test('a chosen file keeps the agent off the other conflicted files', () => {
  const prompt = conflictPrompt({ ...work, kind: 'rebase', paths: ['a.ts'], whole: false })
  assert.match(prompt, /^Resolve 1 rebase conflict in ramu\./)
  assert.match(prompt, /Resolve only these files; leave other conflicted files as they are:\n- a\.ts/)
})

test('a thread starts in the same isolated checkout and is removed when its first message fails', async () => {
  const calls = []
  const invoke = async (_computer, method, ...args) => {
    calls.push([method, ...args])
    if (method === 'tasks.create') return { id: 't2' }
    if (method === 'agent.start') throw new Error('no model')
  }
  const say = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]))
  await assert.rejects(
    startConflictThread(invoke, { ...work, computerId: 'pc', projectId: 'p', workspaceId: 'w1', settings: {}, say }),
    /no model/,
  )
  assert.deepEqual(calls[0], [
    'tasks.create',
    { projectId: 'p', title: 'Resolve merge conflicts in ramu', mode: 'worktree', workspaceId: 'w1' },
  ])
  assert.deepEqual(calls.at(-1), ['tasks.delete', 't2', false])
})

test('every side label has an Indonesian translation', () => {
  for (const label of [CHOICE_LABEL, ALL_FILES_LABEL, ALL_FILES_TITLE].flatMap(Object.values))
    assert.ok(indonesian[label], label)
})
