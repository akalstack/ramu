import { expect, it } from 'vitest'
import { ACCOUNT_HOST_RETRY_MS, AccountHostConnector } from '../src/accountHosts'
import type { ListedHostInfo } from '../src/account'

const listed = (id: string, trust: ListedHostInfo['trust']): ListedHostInfo => ({
  id,
  name: `${id}-name`,
  hostKey: `${id}-key`,
  lastSeen: 0,
  trust,
})

it('adds each listed host that lets the account in once, skips the rest, and retries a failure later', async () => {
  let now = 1_000
  const added = new Set<string>()
  const saved = new Set<string>(['kept-key'])
  const tried: string[] = []
  let fail = true
  const connector = new AccountHostConnector({
    hosts: async () => [
      listed('home', 'owner'),
      listed('studio', 'viewer'),
      listed('work', 'ask'),
      listed('kept', 'owner'),
      listed('off', 'owner'),
    ],
    saved: (hostKey) => saved.has(hostKey),
    added,
    pair: async (host) => {
      tried.push(host.id)
      if (host.id === 'off' && fail) throw new Error('The host did not answer in time.')
      saved.add(host.hostKey)
    },
    now: () => now,
  })
  expect(await connector.connect()).toEqual(['home-name', 'studio-name'])
  expect(tried).toEqual(['home', 'studio', 'off'])

  // A host forgotten on this device is not added again on its own; one that was off waits before another try.
  saved.delete('home-key')
  tried.length = 0
  expect(await connector.connect()).toEqual([])
  expect(tried).toEqual([])
  now += ACCOUNT_HOST_RETRY_MS + 1
  fail = false
  expect(await connector.connect()).toEqual(['off-name'])
  expect(tried).toEqual(['off'])
})

it('runs one pass at a time', async () => {
  let calls = 0
  const connector = new AccountHostConnector({
    hosts: async () => (calls++, []),
    saved: () => false,
    added: new Set(),
    pair: async () => {},
  })
  await Promise.all([connector.connect(), connector.connect()])
  expect(calls).toBe(1)
})
