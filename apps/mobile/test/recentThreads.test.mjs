import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recentThreads } from '../src/runtime/recentThreads.ts'
test('home bounds history across projects while keeping every active or attention thread visible', () => {
  const history = Array.from({ length: 25 }, (_, id) => ({ id, status: 'idle', projectId: `p${id % 3}` }))
  const active = ['running', 'failed', 'needs-input'].map((status, id) => ({ id: `a${id}`, status }))
  const all = [...history, ...active]
  const first = recentThreads(all, 20)
  assert.deepEqual(first.threads, [...active, ...history.slice(0, 20)])
  assert.equal(first.more, true)
  assert.deepEqual(recentThreads(all, 40), { threads: [...active, ...history], more: false })
  assert.deepEqual(recentThreads([], 20), { threads: [], more: false })
})
