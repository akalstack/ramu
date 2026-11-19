import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editFromHere } from '../src/runtime/editFromHere.ts'

const preview = {
  token: 'undo-1',
  files: [
    { fileId: 'a', path: 'a.ts', status: 'ready' },
    { fileId: 'b', path: 'b.ts', status: 'changed-since' },
  ],
}
const run = async (answer, { writable = true } = {}) => {
  const calls = []
  let offered
  const invoke = async (method, ...args) => {
    calls.push([method, ...args])
    return method === 'reviews.chatUndoPreview' ? preview : undefined
  }
  const result = await editFromHere({
    invoke,
    sessionId: 's',
    seq: 7,
    confirm: async (revertable) => {
      offered = revertable
      return answer
    },
    stillWritable: () => writable,
  })
  return { result, calls: calls.map((call) => call[0]), offered, all: calls }
}

test('Edit from here offers to revert only the files that can be put back', async () => {
  assert.equal((await run(null)).offered, 1)
})

test('cancelling leaves the thread and files as they are', async () => {
  const { result, calls } = await run(null)
  assert.equal(result, 'cancelled')
  assert.deepEqual(calls, ['reviews.chatUndoPreview'])
})

test('Edit from here rewinds the thread to before the message, keeping files', async () => {
  const { result, all } = await run('keep')
  assert.equal(result, 'rewound')
  assert.deepEqual(all.at(-1), ['agent.rewind', 's', 7])
  assert.ok(!all.some((call) => call[0] === 'reviews.chatUndoApply'))
})

test('reverting puts back the ready files first, then rewinds', async () => {
  const { result, all } = await run('revert')
  assert.equal(result, 'rewound')
  assert.deepEqual(all.slice(1), [
    ['reviews.chatUndoApply', 'undo-1', ['a']],
    ['agent.rewind', 's', 7],
  ])
})

test('a device that became view-only while asked changes nothing', async () => {
  const { result, calls } = await run('revert', { writable: false })
  assert.equal(result, 'cancelled')
  assert.deepEqual(calls, ['reviews.chatUndoPreview'])
})
