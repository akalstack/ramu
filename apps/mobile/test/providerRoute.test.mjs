import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeChip } from '../src/runtime/providerRoute.ts'

test('names the fallback the next message switches to, or that the provider is kept, and nothing otherwise', () => {
  const route = { state: 'switch', provider: 'codex', model: 'gpt-sol', reason: 'Claude 5h 92%', held: null }
  assert.deepEqual(routeChip(route), { kind: 'switch', to: 'codex', model: 'gpt-sol', reason: 'Claude 5h 92%' })
  assert.deepEqual(routeChip({ ...route, held: 'chat' }), { kind: 'keeping', scope: 'chat', fallback: 'codex' })
  assert.equal(routeChip({ state: 'stays' }), null)
  assert.equal(routeChip({ state: 'unknown' }), null)
  assert.equal(routeChip(null), null)
})
