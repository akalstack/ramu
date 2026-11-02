import { expect, it } from 'vitest'
import type { AgentHostSummary, Computer } from '@ramu/shared/types'
import { agentHostChoices } from '../src/settings/agentHostChoices'

const computer = (id: string, extra: Partial<Computer> = {}): Computer => ({
  id,
  name: id,
  local: false,
  url: `http://${id}:7788`,
  status: 'connected',
  running: 0,
  needsInput: 0,
  pairedAt: 1,
  ...extra,
})

it('offers paired hosts agents do not use yet, and skips this host and SSH tunnels', () => {
  const computers = [
    computer('local', { local: true, url: null }),
    computer('tunnel', { ssh: 'vps' }),
    computer('added'),
    computer('free'),
  ]
  const added = [{ address: 'http://added:7788/' }] as AgentHostSummary[]
  expect(agentHostChoices(computers, added).map((entry) => entry.id)).toEqual(['free'])
})
