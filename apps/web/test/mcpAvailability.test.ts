import { expect, it } from 'vitest'
import type { SharedMcpAccountReadiness, SharedMcpConnection } from '@ramu/shared/mcp'
import { connectionAvailability } from '../src/settings/mcpAvailability'

const connection: SharedMcpConnection = {
  id: 'c',
  hostId: 'h',
  name: 'Tracker',
  serviceAccountId: 'alice',
  revision: '1',
  enabled: true,
  scope: { projectIds: [], hostWide: true },
  providers: ['claude-code', 'codex'],
  transport: { type: 'http', url: 'https://tracker.example/mcp', headerSecretRefs: {} },
}
const login = (
  provider: SharedMcpAccountReadiness['provider'],
  accountId: string,
  status: SharedMcpAccountReadiness['status'],
): SharedMcpAccountReadiness => ({
  provider,
  accountId,
  status,
  checkedAt: 1,
  reason: '',
  connections: [{ connectionId: 'c', name: 'Tracker', status }],
})

it('is shared only when every set-up login of the provider is checked and approved', () => {
  const readiness = [login('codex', 'a', 'ready'), login('codex', 'b', 'approval-needed')]
  expect(connectionAvailability(connection, 'connected', readiness, 'codex').state).toBe('approval-needed')
  expect(connectionAvailability(connection, 'connected', [login('codex', 'a', 'ready')], 'codex').state).toBe('shared')
})

it('never reads a grant or a connected handshake as shared without a set-up login', () => {
  expect(connectionAvailability(connection, 'connected', [], 'codex').state).toBe('not-checked')
  expect(connectionAvailability(connection, 'connected', undefined, 'claude-code').state).toBe('not-checked')
})

it('separates disabled, not enabled for the provider, sign-in and unsupported', () => {
  expect(connectionAvailability({ ...connection, enabled: false }, 'disabled', [], 'codex').state).toBe('disabled')
  expect(connectionAvailability(connection, 'connected', [], 'opencode')).toMatchObject({ state: 'disabled' })
  expect(connectionAvailability(connection, 'sign-in-required', [], 'codex').state).toBe('sign-in-required')
  expect(connectionAvailability(connection, 'unsupported', [], 'codex').state).toBe('unsupported')
})

it('reads Native only when the provider is not offered this connection but already has a server of that name', () => {
  const managed = [{ provider: 'cursor' as const, name: 'Tracker' }]
  expect(connectionAvailability(connection, 'connected', [], 'cursor', managed).state).toBe('native-only')
  // Another provider, another name, or a connection the provider is offered are unaffected.
  expect(connectionAvailability(connection, 'connected', [], 'antigravity', managed).state).toBe('disabled')
  expect(
    connectionAvailability(connection, 'connected', [], 'cursor', [{ provider: 'cursor', name: 'Other' }]).state,
  ).toBe('disabled')
  expect(
    connectionAvailability(connection, 'connected', [], 'codex', [{ provider: 'codex', name: 'Tracker' }]).state,
  ).not.toBe('native-only')
})
