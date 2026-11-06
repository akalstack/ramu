import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { needsOwnCheckout, otherWriters } from '../src/agent/helperCheckout'

const helper = { background: false, readOnly: false, teammate: false, otherWriters: 0 }

it('shares the checkout with a helper the thread waits for alone', () => {
  expect(needsOwnCheckout(helper)).toBe(false)
})

it('gives a copy to a helper that writes beside other work', () => {
  expect(needsOwnCheckout({ ...helper, background: true })).toBe(true)
  expect(needsOwnCheckout({ ...helper, otherWriters: 1 })).toBe(true)
})

it('never copies for a read-only helper or a teammate', () => {
  expect(needsOwnCheckout({ ...helper, background: true, readOnly: true })).toBe(false)
  expect(needsOwnCheckout({ ...helper, otherWriters: 2, teammate: true })).toBe(false)
})

describe('otherWriters', () => {
  const call = (toolUseId: string, name = 'mcp__ramu__ramu_agent') =>
    ({ kind: 'tool-use', toolUseId, name, summary: '' }) as AgentEvent
  const done = (toolUseId: string) => ({ kind: 'tool-result', toolUseId, isError: false, summary: '' }) as AgentEvent
  const user = { kind: 'user', text: 'go' } as AgentEvent

  it('counts a sibling the model started in the same step before its start reaches Ramu', () => {
    expect(otherWriters({ events: [user, call('a'), call('b')], running: 0, starting: 0 })).toBe(1)
    // Two helpers in one step: the first to arrive sees the second and takes a copy too.
    expect(needsOwnCheckout({ ...helper, otherWriters: 1 })).toBe(true)
  })

  it('ignores finished calls, other tools and calls left open by an earlier turn', () => {
    const events = [call('old'), user, call('a'), done('a'), call('b'), call('c', 'mcp__ramu__memory_read')]
    expect(otherWriters({ events, running: 0, starting: 0 })).toBe(0)
  })

  it('counts running and starting helpers when the provider reports no calls', () => {
    expect(otherWriters({ events: [user], running: 1, starting: 1 })).toBe(2)
  })
})
