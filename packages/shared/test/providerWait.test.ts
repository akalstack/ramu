import { describe, expect, it } from 'vitest'
import {
  effectiveAutoResume,
  handoffSummary,
  limitTrayCase,
  providerWaitOf,
  providerWaitState,
} from '../src/chat/providerWait'
import type { AgentEvent } from '../src/types'

const wait = (retryAt: number | null): AgentEvent => ({ kind: 'provider-wait', retryAt, updatedAt: 1 })
const done: AgentEvent = { kind: 'result', text: 'done', isError: false, costUsd: null }

it('reports the retry time while a wait is open', () => {
  expect(providerWaitOf([done, wait(5000)])).toEqual({ retryAt: 5000 })
  expect(providerWaitOf([wait(5000), done])).toEqual({ retryAt: 5000 })
})

it('is over once the wait is cleared, and uses only the latest wait', () => {
  expect(providerWaitOf([wait(5000), wait(null)])).toBeNull()
  expect(providerWaitOf([wait(null), wait(9000)])).toEqual({ retryAt: 9000 })
  expect(providerWaitOf([done])).toBeNull()
  expect(providerWaitOf([])).toBeNull()
})

describe('limit wait state and policy', () => {
  it('reads the open wait with its reset quality', () => {
    const events: AgentEvent[] = [
      { kind: 'provider-wait', retryAt: 9000, updatedAt: 1, guessed: true, provider: 'codex', accountId: 'work' },
    ]
    expect(providerWaitState(events)).toEqual({
      retryAt: 9000,
      guessed: true,
      provider: 'codex',
      accountId: 'work',
      resetNotified: false,
    })
    expect(providerWaitState([...events, { kind: 'provider-wait', retryAt: null, updatedAt: 2 }])).toBeNull()
    expect(
      providerWaitState([{ kind: 'provider-wait', retryAt: 5, updatedAt: 1, resetNotifiedAt: 7, reason: 'too big' }]),
    ).toEqual({ retryAt: 5, guessed: false, resetNotified: true, reason: 'too big' })
  })

  it('resolves auto-resume as thread override, then inherited, then the global default, which is on when unset', () => {
    expect(effectiveAutoResume({}, undefined)).toEqual({ value: true, source: 'default' })
    expect(effectiveAutoResume({}, { autoResume: false })).toEqual({ value: false, source: 'default' })
    expect(effectiveAutoResume({ autoResume: true }, { autoResume: false })).toEqual({ value: true, source: 'thread' })
    expect(effectiveAutoResume({ autoResume: false }, { autoResume: true })).toEqual({ value: false, source: 'thread' })
    // A sub-agent follows its parent's own override, and otherwise the live global value.
    expect(effectiveAutoResume({}, { autoResume: true }, { autoResume: false })).toEqual({
      value: false,
      source: 'thread',
    })
    expect(effectiveAutoResume({}, { autoResume: false }, {})).toEqual({ value: false, source: 'default' })
  })

  it('picks the tray row for every combination of auto-resume and reset quality', () => {
    const now = 1000
    expect(limitTrayCase({ retryAt: 5000, guessed: false }, true, now)).toBe('auto-known')
    expect(limitTrayCase({ retryAt: 5000, guessed: true }, true, now)).toBe('auto-unknown')
    expect(limitTrayCase({ retryAt: 500, guessed: false }, true, now)).toBe('auto-unknown')
    expect(limitTrayCase({ retryAt: 5000, guessed: false }, false, now)).toBe('off-known')
    expect(limitTrayCase({ retryAt: 5000, guessed: true }, false, now)).toBe('off-unknown')
    expect(limitTrayCase({ retryAt: 500, guessed: false }, false, now)).toBe('reset-off')
    // A guessed time that has passed proves nothing about the limit, so it is not "has reset".
    expect(limitTrayCase({ retryAt: 500, guessed: true }, false, now)).toBe('off-unknown')
  })

  it('summarises a handoff only once it was built', () => {
    expect(handoffSummary(undefined)).toBeNull()
    expect(handoffSummary({ cause: 'limit', mode: 'full', from: 'claude-code' })).toMatchObject({ range: null })
    expect(
      handoffSummary({
        cause: 'switch',
        mode: 'delta',
        from: 'codex',
        fromSeq: 30,
        toSeq: 41,
        shortened: 2,
        chars: 900,
      }),
    ).toEqual({ mode: 'delta', cause: 'switch', from: 'codex', range: [30, 41], shortened: 2, omitted: 0, chars: 900 })
  })
})
