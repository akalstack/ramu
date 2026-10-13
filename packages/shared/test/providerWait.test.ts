import { expect, it } from 'vitest'
import { providerWaitOf } from '../src/providerWait'
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
