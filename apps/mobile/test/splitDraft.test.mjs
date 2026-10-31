import { test } from 'node:test'
import assert from 'node:assert/strict'
import { otherHostTargets, readSplitDraft, startSplit } from '../src/runtime/splitDraft.ts'

const draft = {
  version: 1,
  original: 'Add dueDate everywhere',
  contract: 'Field dueDate',
  settings: { provider: 'claude-code', model: '', effort: null, access: 'full', autoFallback: true },
  rows: [
    { key: 'api', computerId: 'a', projectId: 'api', label: 'api', title: 'Store', brief: 'API part' },
    {
      key: 'host0:jobs',
      computerId: 'b',
      projectId: 'jobs',
      label: 'jobs · vps',
      title: 'Backfill',
      brief: 'Jobs part',
    },
  ],
}

test('weighs only projects on other online hosts, with ids local to the request', () => {
  const { targets, candidates } = otherHostTargets(
    'a',
    [
      { id: 'a', name: 'Laptop', status: 'online' },
      { id: 'b', name: 'VPS', status: 'online' },
      { id: 'c', name: 'Old', status: 'offline' },
    ],
    [
      { id: 'a:api', computerId: 'a', name: 'api' },
      { id: 'b:jobs', computerId: 'b', name: 'jobs', description: 'Background jobs' },
      { id: 'c:web', computerId: 'c', name: 'web' },
    ],
  )
  assert.deepEqual(candidates, [{ id: 'host0:jobs', name: 'jobs', host: 'VPS', description: 'Background jobs' }])
  assert.deepEqual(targets.get('host0:jobs'), {
    computerId: 'b',
    projectId: 'jobs',
    name: 'jobs',
    hostName: 'VPS',
    description: 'Background jobs',
  })
})

test('starts each host’s rows there as one group, keeping a failing host’s rows as errors', async () => {
  const calls = []
  const started = await startSplit(
    draft,
    async (host, method, input) => {
      calls.push({ host, method, input })
      if (host === 'b') throw new Error('Offline')
      return input.threads.map((thread, index) => ({
        taskId: `${host}${index}`,
        title: thread.title,
        projectName: 'p',
      }))
    },
    'group-1',
  )
  assert.deepEqual(
    calls.map((call) => [call.host, call.input.groupId, call.input.together]),
    [
      ['a', 'group-1', ['Store', 'Backfill']],
      ['b', 'group-1', ['Store', 'Backfill']],
    ],
  )
  assert.match(calls[0].input.threads[0].prompt, /API part[\s\S]*Field dueDate[\s\S]*Add dueDate everywhere/)
  assert.deepEqual(
    started.map((entry) => [entry.computerId, entry.taskId, entry.error ?? null]),
    [
      ['a', 'a0', null],
      ['b', '', 'Offline'],
    ],
  )
})

test('restores only a well-formed draft with rows', () => {
  assert.equal(readSplitDraft(JSON.stringify(draft)).rows.length, 2)
  assert.equal(readSplitDraft(JSON.stringify({ ...draft, rows: [] })), null)
  assert.equal(readSplitDraft('nonsense'), null)
  assert.equal(readSplitDraft(undefined), null)
})
