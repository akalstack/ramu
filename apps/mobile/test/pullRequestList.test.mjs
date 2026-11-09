import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checksAside, hiddenAccess, offlineHosts, pullRequestRepoLabel } from '../src/runtime/pullRequestList.ts'

test('hidden access notices read back from their saved draft, and a broken one hides none', () => {
  assert.deepEqual(hiddenAccess(JSON.stringify(['a\ngithub\nsigned-out', 3])), ['a\ngithub\nsigned-out'])
  assert.deepEqual(hiddenAccess(undefined), [])
  assert.deepEqual(hiddenAccess('{broken'), [])
})

test('a host kept on the phone but out of reach lists its last rows as offline', () => {
  assert.deepEqual(offlineHosts(['a', 'b', 'c'], ['b']), ['a', 'c'])
})

test('a row adds its checks only when its stage is about something else', () => {
  assert.equal(checksAside({ stage: 'checks-failing', pr: { checks: 'failure' } }), false)
  assert.equal(checksAside({ stage: 'changes-requested', pr: { checks: 'failure' } }), true)
  assert.equal(checksAside({ stage: 'ready', pr: { checks: 'success' } }), false)
  assert.equal(pullRequestRepoLabel({ projectName: 'ai-brain', repoName: 'ai-brain-web' }), 'ai-brain / ai-brain-web')
  assert.equal(pullRequestRepoLabel({ projectName: 'hydra', repoName: 'hydra' }), 'hydra')
})
