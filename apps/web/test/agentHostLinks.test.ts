import { expect, it } from 'vitest'
import type { AgentHostSummary, Computer } from '@ramu/shared/types'
import { sameAddress, unlistedAgentHosts } from '../src/settings/agentHostLinks'

it('treats addresses that differ by a trailing slash as one host', () => {
  expect(sameAddress('http://mini:7788/', 'http://mini:7788')).toBe(true)
  expect(sameAddress('http://mini:7788', 'http://vps:7788')).toBe(false)
})

it('lists only agent hosts that have no row in the host list', () => {
  const hosts = [{ address: 'http://mini:7788/' }, { address: 'http://vps:7788' }] as AgentHostSummary[]
  const computers = [{ url: 'http://mini:7788' }, { url: null }] as Computer[]
  expect(unlistedAgentHosts(hosts, computers).map((host) => host.address)).toEqual(['http://vps:7788'])
})
