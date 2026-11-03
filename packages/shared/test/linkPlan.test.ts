import { expect, it } from 'vitest'
import { planSummary } from '../src/link/plan'
import type { LinkPlanStatus } from '../src/link/protocol'

const free: LinkPlanStatus = {
  plan: 'free',
  source: 'free',
  expiresAt: null,
  renews: false,
  hosts: 3,
  hostLimit: 3,
  month: '2026-11',
  relayedSeconds: 60 * 3600,
  relayedLimitSeconds: 60 * 3600,
  checkout: true,
}

it('reads a Free account at both limits as one that can get Plus', () => {
  expect(planSummary(free)).toEqual({
    hoursUsed: 60,
    hoursLimit: 60,
    outOfHours: true,
    atHostLimit: true,
    canGetPlus: true,
  })
  expect(planSummary({ ...free, relayedSeconds: 3599, hosts: 1 })).toMatchObject({
    hoursUsed: 0,
    outOfHours: false,
    atHostLimit: false,
  })
})

it('offers nothing to buy on Plus or on a service that sells nothing', () => {
  const plus = { ...free, plan: 'plus' as const, hostLimit: 20, relayedLimitSeconds: null }
  expect(planSummary(plus)).toMatchObject({ hoursLimit: null, outOfHours: false, canGetPlus: false })
  expect(planSummary({ ...free, checkout: false }).canGetPlus).toBe(false)
})
