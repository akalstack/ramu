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
  expect(logins[0]).toMatchObject({
    email: 'me@x.io',
    hosts: ['Mac', 'vps'],
    places: [
      { hostId: 'a', accountId: 'default' },
      { hostId: 'b', accountId: 'acc-9' },
    ],
  })
  expect(peakOf(logins[0]!)?.usedPercent).toBe(55)
})

it('matches a login without an email across hosts by identical limits, and keeps different ones apart', () => {
  const at = (
    accountId: string | undefined,
    window: UsageReading['window'],
    usedPercent: number,
    resetsAt: number,
  ) => ({
    ...reading(accountId, usedPercent, 1_000),
    window,
    resetsAt,
  })
  const logins = loginsAcrossHosts([
    {
      hostId: 'a',
      host: 'Mac',
      readings: [at(undefined, 'five_hour', 30, 5_000_000), at('two', 'five_hour', 80, 9_000_000)],
      emails: {},
    },
    { hostId: 'b', host: 'vps', readings: [at('x', 'five_hour', 31, 5_030_000)], emails: {} },
  ])
  expect(logins.map((login) => [login.hosts, login.matchedBy, peakOf(login)?.usedPercent])).toEqual([
    [['Mac', 'vps'], 'limits', 30],
    [['Mac'], undefined, 80],
  ])
  expect(logins[0]!.places).toEqual([
    { hostId: 'a', accountId: 'default' },
    { hostId: 'b', accountId: 'x' },
  ])
})

it('joins a host that lacks the email to the emailed login with the same limits, keeping its email', () => {
  const at = (accountId: string | undefined, usedPercent: number) => ({
    ...reading(accountId, usedPercent, 1_000),
    window: 'five_hour' as const,
    resetsAt: 7_000_000,
  })
  const logins = loginsAcrossHosts([
    { hostId: 'a', host: 'Mac', readings: [at(undefined, 87)], emails: { 'claude-code': { default: 'me@x.io' } } },
    { hostId: 'b', host: 'mini', readings: [at(undefined, 87), { ...at('team', 0), resetsAt: 1_000 }], emails: {} },
  ])
  expect(logins.map((login) => [login.email, login.hosts, login.matchedBy])).toEqual([
    ['me@x.io', ['Mac', 'mini'], 'limits'],
    [null, ['mini'], undefined],
  ])
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

it('adds each host’s activity, marks unpriced turns and names hosts it could not read', async () => {
  const { activityAcrossHosts } = await import('../src/usageAcrossHosts')
  const row = (turns: number, costUsd: number, unpriced = 0) => ({
    day: '2026-11-02',
    provider: 'claude-code' as const,
    turns,
    costUsd,
    unpriced,
  })
  const total = activityAcrossHosts([
    { host: 'Mac', rows: [row(3, 1.5)] },
    { host: 'vps', rows: [row(2, 0, 2)] },
    { host: 'gpu', rows: null },
  ])
  expect(total).toMatchObject({ turns: 5, costUsd: 1.5, unpricedOn: ['vps'], missing: ['gpu'] })
  expect(total.byHost).toEqual([
    { host: 'Mac', turns: 3, costUsd: 1.5, tokens: 0 },
    { host: 'vps', turns: 2, costUsd: 0, tokens: 0 },
  ])
})

it('adds tokens where turns report them and names hosts whose turns do not, including older hosts', async () => {
  const { activityAcrossHosts } = await import('../src/usageAcrossHosts')
  const row = (turns: number, tokens?: number, untokened?: number) => ({
    day: '2026-11-02',
    provider: 'codex' as const,
    turns,
    costUsd: 0,
    unpriced: turns,
    ...(tokens === undefined ? {} : { tokens, untokened }),
  })
  const total = activityAcrossHosts([
    { host: 'Mac', rows: [row(3, 12_000, 0)] },
    { host: 'vps', rows: [row(2, 500, 1)] },
    // A host from before token counts sends neither field.
    { host: 'old', rows: [row(4)] },
  ])
  expect(total).toMatchObject({ turns: 9, tokens: 12_500, untokenedOn: ['vps', 'old'] })
})
