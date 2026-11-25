import { expect, it } from 'vitest'
import { loginRows, loginsAcrossHosts, loginsWithRoom, peakOf, providerLoginRows } from '../src/usageAcrossHosts'
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
    tokens: 0,
    untokened: 0,
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

it('adds tokens where turns report them and names hosts whose turns do not', async () => {
  const { activityAcrossHosts } = await import('../src/usageAcrossHosts')
  const row = (turns: number, tokens: number, untokened: number) => ({
    day: '2026-11-02',
    provider: 'codex' as const,
    turns,
    costUsd: 0,
    unpriced: turns,
    tokens,
    untokened,
  })
  const total = activityAcrossHosts([
    { host: 'Mac', rows: [row(3, 12_000, 0)] },
    { host: 'vps', rows: [row(2, 500, 1)] },
  ])
  expect(total).toMatchObject({ turns: 5, tokens: 12_500, untokenedOn: ['vps'] })
})

const hostLogins = (hostId: string, readings: UsageReading[], emails: Record<string, string>, accountId?: string) => ({
  hostId,
  host: hostId.toUpperCase(),
  readings,
  emails: { 'claude-code': emails },
  config: accountId ? { 'claude-code': { binary: 'claude', accountId } } : undefined,
})

it('marks the login threads use, on the current host or on any host', () => {
  const hosts = [
    hostLogins('a', [reading(undefined, 30, 1), reading('acc-2', 90, 1)], { default: 'one@x.io', 'acc-2': 'two@x.io' }),
    hostLogins('b', [reading('acc-7', 10, 1)], { 'acc-7': 'two@x.io' }, 'acc-7'),
  ]
  const onA = loginRows(hosts, 'a')
  const one = onA.find((row) => row.email === 'one@x.io')!
  const two = onA.find((row) => row.email === 'two@x.io')!
  expect(one).toMatchObject({ inUse: true, namedBy: { hostId: 'a', accountId: 'default' } })
  expect(two).toMatchObject({
    inUse: false,
    namedBy: { hostId: 'a', accountId: 'acc-2' },
    where: [
      { hostId: 'a', inUse: false },
      { hostId: 'b', inUse: true },
    ],
  })
  // Opened for no host in particular, a login is in use when any host's threads use it.
  expect(loginRows(hosts).find((row) => row.email === 'two@x.io')!.inUse).toBe(true)
})

it('lists the login in use first, then the ones another host uses, then the most room', () => {
  const hosts = [
    hostLogins(
      'a',
      [reading('full', 100, 1), reading('roomy', 5, 1), reading('used', 70, 1), reading(undefined, 95, 1)],
      { full: 'f@x.io', roomy: 'r@x.io', used: 'u@x.io', default: 'd@x.io' },
    ),
    hostLogins('b', [reading('u2', 70, 2)], { u2: 'u@x.io' }, 'u2'),
  ]
  const rows = providerLoginRows(loginRows(hosts, 'a'), 'claude-code')
  expect(rows.map((row) => row.email)).toEqual(['d@x.io', 'u@x.io', 'r@x.io', 'f@x.io'])
  expect(loginsWithRoom(rows)).toBe(3)
})
