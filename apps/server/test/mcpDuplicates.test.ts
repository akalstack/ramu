import { expect, it } from 'vitest'
import type { ProjectSetup } from '@ramu/shared/mcp'
import { allowedConnections, chooseDuplicate, duplicateConnectionIds } from '../src/mcp/duplicates'
import { buildSetupSnapshot } from '../src/agent/effectiveSetup'

const server = (managedConnectionId: string | undefined, nativeProviders: string[]) =>
  ({ managedConnectionId, nativeProviders }) as unknown as ProjectSetup['mcp'][number]

it('finds only shared connections whose server this provider already loads', () => {
  const setup = {
    mcp: [server('a', ['codex']), server('b', ['claude-code']), server(undefined, ['codex'])],
  } as ProjectSetup
  expect([...duplicateConnectionIds(setup, 'codex')]).toEqual(['a'])
})

it('keeps a chat’s choices per chat and restores both copies', () => {
  let choices = chooseDuplicate({}, 's1', 'a', 'native')
  choices = chooseDuplicate(choices, 's1', 'b', 'native')
  choices = chooseDuplicate(choices, 's2', 'a', 'native')
  expect(allowedConnections(choices, 's1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual(['c'])
  expect(allowedConnections(choices, 's3', [{ id: 'a' }])).toBeUndefined()
  choices = chooseDuplicate(choices, 's1', 'a', 'both')
  choices = chooseDuplicate(choices, 's1', 'b', 'both')
  expect(choices).toEqual({ s2: ['a'] })
})

it('tells a thread about a duplicate and what it chose, without hiding the item', () => {
  const input = {
    sessionId: 's',
    provider: 'codex' as const,
    accountId: 'x',
    projectId: 'p',
    startedAt: 0,
    rules: [],
    addedServers: [],
    sharedSkills: [],
    connections: [{ connectionId: 'a', name: 'Docs', status: 'ready' as const }],
    duplicates: new Set(['a']),
    now: 1,
  }
  const both = buildSetupSnapshot(input).items[0]!
  expect(both).toMatchObject({ state: 'configured', duplicate: { connectionId: 'a', use: 'both' } })
  const native = buildSetupSnapshot({ ...input, hidden: ['a'] }).items[0]!
  expect(native).toMatchObject({ state: 'omitted', duplicate: { use: 'native' } })
})
