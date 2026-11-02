import { expect, it } from 'vitest'
import { loginsAcrossHosts, peakOf } from '../src/usageAcrossHosts'
import type { UsageReading } from '../src/types'

const reading = (accountId: string | undefined, usedPercent: number, updatedAt: number): UsageReading => ({
  provider: 'claude-code',
  ...(accountId ? { accountId } : {}),
  window: 'weekly',
  usedPercent,
  status: 'ok',
  updatedAt,
})

it('shows a login used on two hosts once, with its newest reading', () => {
  const logins = loginsAcrossHosts([
    {
      hostId: 'a',
      host: 'Mac',
      readings: [reading(undefined, 40, 1)],
      emails: { 'claude-code': { default: 'Me@x.io' } },
    },
    {
      hostId: 'b',
      host: 'vps',
      readings: [reading('acc-9', 55, 2)],
      emails: { 'claude-code': { 'acc-9': 'me@x.io' } },
    },
  ])
  expect(logins).toHaveLength(1)
  expect(logins[0]).toMatchObject({ email: 'me@x.io', hosts: ['Mac', 'vps'] })
  expect(peakOf(logins[0]!)?.usedPercent).toBe(55)
})

it('lists a login it cannot match by host, never adding percentages', () => {
  const logins = loginsAcrossHosts([
    { hostId: 'a', host: 'Mac', readings: [reading(undefined, 40, 1)], emails: {} },
    { hostId: 'b', host: 'vps', readings: [reading(undefined, 10, 1)], emails: {} },
  ])
  expect(logins.map((login) => [login.hosts, peakOf(login)?.usedPercent])).toEqual([
    [['Mac'], 40],
    [['vps'], 10],
  ])
})
