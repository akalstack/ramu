import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceToolKey, mobileThreadActivity } from '../src/runtime/threadActivity.ts'
const helper = (agentId, status = 'running', extra = {}) => ({
  id: agentId,
  agentId,
  name: agentId,
  type: '',
  status,
  ...extra,
})
const chat = (items, extra = {}) => ({ items, queue: [], goal: null, status: 'idle', ...extra })
test('goal activity distinguishes verification and turn limits from blocked input', () => {
  for (const [goal, expected] of [
    [{ status: 'turn-limit' }, 'turn-limit'],
    [{ status: 'active', claim: { reason: 'done' } }, 'verifying'],
    [{ status: 'active' }, 'active'],
  ]) {
    const activity = mobileThreadActivity(chat([], { goal }), true)
    assert.equal(activity.model.primary, 'goal')
    assert.equal(activity.model.goalState, expected)
    assert.deepEqual(activity.model.requestIds, [])
  }
})
test('parent-idle helpers stay discoverable and advisors never inflate the active helper count', () => {
  const c = chat([
    { kind: 'user', id: 'u' },
    { kind: 'agents', id: 'a', agents: [helper('a'), helper('stopped', 'stopped')] },
    { kind: 'agents', id: 'advisor', advisor: true, agents: [helper('advisor')] },
  ])
  const activity = mobileThreadActivity(c, true)
  assert.equal(activity.model.primary, 'helpers')
  assert.equal(activity.model.counts.active, 1)
  assert.equal(activity.advisors.length, 1)
  assert.equal(activity.model.counts.stopped, 1)
})
test('a new turn retains older active work, drops settled lifetime totals and keeps offline input accessible', () => {
  const c = chat([
    { kind: 'user', id: 'old' },
    { kind: 'agents', id: 'a', agents: [helper('active'), helper('old', 'completed')] },
    { kind: 'user', id: 'new' },
    { kind: 'permission', id: 'p' },
    { kind: 'question', id: 'q', answers: { yes: 'yes' } },
  ])
  assert.deepEqual(
    mobileThreadActivity(c, true).helpers.map((a) => a.agentId),
    ['active'],
  )
  const offline = mobileThreadActivity(c, false)
  assert.equal(offline.model.primary, 'connection')
  assert.deepEqual(offline.model.requestIds, ['p'])
  assert.equal(offline.requests[0].id, 'p')
})
test('phone outbox uncertainty is never counted as a server queue and settled work clears the working state', () => {
  const c = chat(
    [
      { kind: 'user', id: 'u' },
      { kind: 'agents', id: 'a', agents: [helper('done', 'completed')] },
    ],
    { pending: true },
  )
  assert.equal(mobileThreadActivity(c, true).model.primary, null)
  assert.equal(mobileThreadActivity(c, true).model.queueCount, 0)
})

test('idle context compaction is a distinct working state, and blocked goals retain their meaning', () => {
  assert.equal(mobileThreadActivity(chat([], { compacting: true }), true).model.primary, 'working')
  assert.equal(mobileThreadActivity(chat([], { goal: { status: 'blocked' } }), true).model.goalState, 'blocked')
})
test('a thread waiting at its limit leaves the limit to the composer tray, and marks only a try in progress', () => {
  const items = [
    { kind: 'user', id: 'u' },
    { kind: 'error', id: 'e', message: 'Claude usage limit reached.' },
    { kind: 'note', id: 'wait-1', wait: true, limit: { retryAt: Date.now() + 60_000, guessed: false } },
  ]
  assert.equal(mobileThreadActivity(chat(items), true).model.primary, null)
  assert.equal(mobileThreadActivity(chat(items, { status: 'running' }), true).model.primary, 'provider')
  assert.equal(mobileThreadActivity(chat(items, { status: 'running', doneAt: 1 }), true).model.primary, 'working')
})

test('the device tool key follows the newest browser or computer call, so the chips read again', () => {
  const tool = (id, name, status = 'completed') => ({ kind: 'tool', id, source: { name }, status })
  assert.equal(deviceToolKey([tool('a', 'Bash')]), '')
  const items = [
    tool('a', 'mcp__ramu__browser_open'),
    { kind: 'tools', id: 'g', tools: [tool('b', 'Read'), tool('c', 'computer_click', 'in_progress')] },
  ]
  assert.equal(deviceToolKey(items), 'c:in_progress')
  assert.equal(deviceToolKey([...items, tool('d', 'Read')]), 'c:in_progress')
  assert.equal(deviceToolKey([tool('e', 'mcp__ramu__browser_navigate', 'failed')]), 'e:failed')
})
