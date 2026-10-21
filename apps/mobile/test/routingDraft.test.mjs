import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeRouteChoice,
  readRouteChoice,
  readRoutingSelection,
  routingSelectionKey,
  routingSnapshot,
} from '../src/runtime/routingDraft.ts'

test('keeps explicit project and Auto choices scoped to their host without falling back from a removed project', () => {
  const drafts = { [routingSelectionKey('a')]: JSON.stringify({ version: 1, auto: false, projectId: 'a:p' }) }
  assert.deepEqual(readRoutingSelection(drafts, 'a', ['a:p'], true), { auto: false, projectId: 'a:p' })
  assert.deepEqual(readRoutingSelection(drafts, 'b', ['b:p'], true), { auto: true, projectId: null })
  assert.deepEqual(readRoutingSelection(drafts, 'a', [], true), { auto: false, projectId: null })
  drafts[routingSelectionKey('a')] = JSON.stringify({ version: 1, auto: true, projectId: null })
  assert.equal(readRoutingSelection(drafts, 'a', [], false).auto, true)
})
test('restores candidates only for the intact draft and current catalog, including attachments and file context', () => {
  const key = 'a:new:none'
  const drafts = { [key]: 'Fix login', [`${key}:attachments`]: '["image"]', [`${key}:context`]: '[]' }
  const snapshot = routingSnapshot(drafts, key)
  const encoded = encodeRouteChoice({
    draft: snapshot,
    text: 'Fix login',
    attachments: ['image'],
    context: [],
    candidates: [
      { projectId: 'p', reason: 'Login' },
      { projectId: 'removed', reason: 'Old' },
    ],
  })
  assert.deepEqual(readRouteChoice(encoded, snapshot, ['p']).candidates, [{ projectId: 'p', reason: 'Login' }])
  assert.equal(readRouteChoice(encoded, routingSnapshot({ ...drafts, [key]: 'Other request' }, key), ['p']), null)
  assert.equal(readRouteChoice(encoded, routingSnapshot({ ...drafts, [`${key}:attachments`]: '[]' }, key), ['p']), null)
  assert.equal(readRouteChoice(encoded, snapshot, ['other']), null)
  assert.equal(readRouteChoice('{broken', snapshot, ['p']), null)
})
test('bounds persistent routing payloads and never restores a malformed candidate', () => {
  const base = {
    draft: 'draft',
    text: 'request',
    attachments: [],
    context: [],
    candidates: [{ projectId: 'p', reason: '' }],
  }
  assert.equal(encodeRouteChoice({ ...base, text: 'x'.repeat(100_001) }), '')
  assert.equal(readRouteChoice(JSON.stringify({ ...base, version: 1, attachments: [42] }), 'draft', ['p']), null)
  assert.equal(
    readRouteChoice(JSON.stringify({ ...base, version: 1, candidates: [{ projectId: 'p', reason: {} }] }), 'draft', [
      'p',
    ]),
    null,
  )
})
