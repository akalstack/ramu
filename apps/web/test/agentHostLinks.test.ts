import { expect, it } from 'vitest'
import type { AgentHostSummary, Computer } from '@ramu/shared/types'
import { agentReachable, agentsOnEverywhere, sameAddress, unlistedAgentHosts } from '../src/settings/agentHostLinks'

it('treats addresses that differ by a trailing slash as one host', () => {
  expect(sameAddress('http://mini:7788/', 'http://mini:7788')).toBe(true)
  expect(sameAddress('http://mini:7788', 'http://vps:7788')).toBe(false)
})

it('lists only agent hosts that have no row in the host list', () => {
  const hosts = [{ address: 'http://mini:7788/' }, { address: 'http://vps:7788' }] as AgentHostSummary[]
  const computers = [{ url: 'http://mini:7788' }, { url: null }] as Computer[]
  expect(unlistedAgentHosts(hosts, computers).map((host) => host.address)).toEqual(['http://vps:7788'])
  // Added for agents on its LAN address while the host list reaches it over the VPN: still the same host.
  const viaVpn = [
    { url: 'http://100.64.0.7:7788', routes: ['http://vps:7788'] },
    { url: 'http://mini:7788' },
  ] as Computer[]
  expect(unlistedAgentHosts(hosts, viaVpn)).toEqual([])
})

it('reads on for all only when agents use every reachable host', () => {
  const computer = (id: string, extra: Partial<Computer> = {}) =>
    ({ id, url: `http://${id}:7788`, local: false, status: 'connected', ...extra }) as Computer
  const reachable = agentReachable([
    computer('mini'),
    computer('vps'),
    computer('here', { local: true }),
    computer('tunnel', { ssh: 'box' }),
    computer('away', { status: 'offline' }),
  ])
  expect(reachable.map((entry) => entry.id)).toEqual(['mini', 'vps'])
  const mini = { address: 'http://mini:7788/' } as AgentHostSummary
  const vps = { address: 'http://vps:7788' } as AgentHostSummary
  expect(agentsOnEverywhere(reachable, [mini])).toBe(false)
  expect(agentsOnEverywhere(reachable, [mini, vps])).toBe(true)
  expect(agentsOnEverywhere([], [mini])).toBe(false)
})
