import { test } from 'node:test'
import { STREAMING_KINDS } from '../../../packages/shared/src/pushChannels.ts'
import assert from 'node:assert/strict'
import { BASE_CHANNELS, ON_DEMAND_CHANNELS, hostSubscription } from '../src/runtime/hostSubscription.ts'

test('with no screen asking, frequent single-screen channels and unused ones are not requested', () => {
  const idle = hostSubscription([])
  assert.equal(idle.keys, undefined)
  for (const channel of [
    ...ON_DEMAND_CHANNELS,
    'memory:changed',
    'mcp:changed',
    'providers:updates',
    'background:connection',
  ])
    assert.ok(!idle.channels.includes(channel), `${channel} is not requested`)
  for (const channel of [
    'agent:event',
    'workspace:changed',
    'notices:changed',
    'term:exit',
    'term:changed',
    'usage:changed',
  ])
    assert.ok(idle.channels.includes(channel), `${channel} stays subscribed`)
})

test('a screen adds only the channels and resources it shows', () => {
  const watching = hostSubscription([
    { channels: ['term:data', 'term:behind'], keys: { 'term:data': ['t1'], 'term:behind': ['t1'] } },
    { channels: ['context:changed'], keys: { 'context:changed': ['s1'] } },
  ])
  assert.deepEqual(watching.keys, { 'term:data': ['t1'], 'term:behind': ['t1'], 'context:changed': ['s1'] })
  assert.equal(watching.channels.length, BASE_CHANNELS.length + 3)
})

test('two screens on one channel get the union of their resources, and one that wants it all gets it all', () => {
  const two = hostSubscription([
    { channels: ['context:changed'], keys: { 'context:changed': ['s1'] } },
    { channels: ['context:changed'], keys: { 'context:changed': ['s2', 's1'] } },
  ])
  assert.deepEqual(two.keys, { 'context:changed': ['s1', 's2'] })
  const all = hostSubscription([
    { channels: ['context:changed'], keys: { 'context:changed': ['s1'] } },
    { channels: ['context:changed'] },
    { channels: ['context:changed'], keys: { 'context:changed': ['s3'] } },
  ])
  assert.equal(all.keys, undefined)
  assert.ok(all.channels.includes('context:changed'))
})

test('threads are followed in brief, and the thread on screen is streamed in full', () => {
  const idle = hostSubscription([])
  assert.ok(idle.channels.includes('agent:event'))
  assert.deepEqual(idle.skip, { 'agent:event': [...STREAMING_KINDS] })
  assert.equal(idle.keys, undefined)
  for (const kind of ['state', 'question', 'permission-request', 'queue', 'goal', 'settings', 'user'])
    assert.ok(!STREAMING_KINDS.includes(kind), `${kind} is still delivered for every thread`)
  const open = hostSubscription([{ channels: ['agent:event'], keys: { 'agent:event': ['s1'] } }])
  assert.deepEqual(open.keys, { 'agent:event': ['s1'] })
  assert.deepEqual(open.skip, { 'agent:event': [...STREAMING_KINDS] })
})

test('a screen that wants every thread in full turns the brief mode off', () => {
  const all = hostSubscription([{ channels: ['agent:event'] }])
  assert.equal(all.skip, undefined)
})
