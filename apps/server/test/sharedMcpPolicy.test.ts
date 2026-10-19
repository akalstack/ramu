import { describe, expect, it } from 'vitest'
import type { SharedMcpConnection, SharedMcpPolicyState } from '@ramu/shared/mcp'
import { SharedMcpPolicy, sharedMcpCatalogRevision, type ExternalMcpSession } from '../src/mcp/policy'

const input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'> = {
  name: 'Issue tracker',
  serviceAccountId: 'service-alice',
  enabled: true,
  scope: { projectIds: ['project-a'], hostWide: false },
  providers: ['claude-code', 'codex'],
  transport: { type: 'http', url: 'https://mcp.example.test/mcp', headerSecretRefs: {} },
}
const session: ExternalMcpSession = {
  hostId: 'host-a',
  provider: 'claude-code',
  accountId: 'account-a',
  projectId: 'project-a',
  role: 'interactive',
  externalToolsAllowed: true,
}
const catalog = sharedMcpCatalogRevision([{ name: 'read_issue', inputSchema: { type: 'object' } }])

function setup() {
  let saved: SharedMcpPolicyState | undefined
  let fail = false
  const storage = {
    load: () => saved,
    save: (value: SharedMcpPolicyState) => {
      if (fail) throw new Error('Storage locked')
      saved = structuredClone(value)
    },
  }
  const policy = new SharedMcpPolicy('host-a', storage)
  const connection = policy.saveConnection(input)
  const approve = (accountId = 'account-a', provider = session.provider) =>
    policy.approve({
      connectionId: connection.id,
      revision: policy.snapshot().connections.find((entry) => entry.id === connection.id)!.revision,
      catalogRevision: catalog,
      provider,
      accountId,
      scope: input.scope,
      tools: [
        { name: 'read_issue', action: 'read', approval: 'connection' },
        { name: 'update_issue', action: 'write', approval: 'always' },
      ],
    })
  const addAccount = (accountId: string, shareApprovals = true, provider = session.provider) =>
    policy.saveAccount({ provider, accountId, shareApprovals })
  const access = (accountId = 'account-a', changes: Partial<ExternalMcpSession> = {}) =>
    policy.access({ ...session, accountId, ...changes }, connection.id, catalog).status
  return {
    policy,
    connection,
    approve,
    addAccount,
    access,
    storage,
    fail: () => {
      fail = true
    },
  }
}

describe('Shared MCP account consent', () => {
  it('shares existing and new approvals in both directions and survives restart', () => {
    const { policy, connection, addAccount, approve, access, storage } = setup()
    addAccount('account-a')
    approve()
    addAccount('account-b')
    expect(access('account-b')).toBe('approved')
    const original = policy.snapshot().grants[0]!
    policy.revoke(original.id)
    approve('account-b')
    expect(access('account-a')).toBe('approved')
    expect(access('account-b')).toBe('approved')
    // Saving setup again and reordering accounts must not discard or transfer approvals.
    addAccount('account-b')
    addAccount('account-a')
    const restarted = new SharedMcpPolicy('host-a', storage)
    for (const accountId of ['account-a', 'account-b'])
      expect(restarted.authorize({ ...session, accountId }, connection.id, catalog, 'read_issue')).toMatchObject({
        requiresApproval: false,
        action: 'read',
      })
  })

  it('does not infer consent from an account login, similar name or account on another provider', () => {
    const { addAccount, approve, access } = setup()
    addAccount('account-a')
    approve()
    expect(access('account-a-copy')).toBe('approval-needed')
    addAccount('account-b', false)
    expect(access('account-b')).toBe('approval-needed')
    addAccount('account-a', true, 'codex')
    expect(access('account-a', { provider: 'codex' })).toBe('approval-needed')
  })

  it('sharing opt-in covers existing private approvals but opt-out revokes future shared access', () => {
    const { addAccount, approve, access } = setup()
    addAccount('account-a', false)
    addAccount('account-b')
    approve()
    expect(access()).toBe('approved')
    expect(access('account-b')).toBe('approval-needed')
    addAccount('account-a')
    expect(access('account-b')).toBe('approved')
    addAccount('account-a', false)
    expect(access()).toBe('approval-needed')
    expect(access('account-b')).toBe('approved')
    approve('account-b')
    expect(access()).toBe('approval-needed')
  })

  it('removes accounts immediately without changing the other participating identity', () => {
    const { policy, addAccount, approve, access } = setup()
    addAccount('account-a')
    addAccount('account-b')
    approve()
    policy.removeAccount('claude-code', 'account-b')
    expect(access('account-b')).toBe('approval-needed')
    expect(access()).toBe('approved')
    // A removed login cannot recover trust merely by being recreated without consent.
    addAccount('account-b', false)
    expect(access('account-b')).toBe('approval-needed')
  })
})

describe('Shared MCP authorization boundary', () => {
  it.each([
    { hostId: 'host-b' },
    { projectId: 'project-b' },
    { projectId: null },
    { role: 'restricted' as const },
    { role: 'background' as const, externalToolsAllowed: false },
    { externalToolsAllowed: false },
    { connectionIds: [] },
    { connectionIds: ['forged'] },
  ])('rejects a scope escalation %j at discovery and dispatch', (changes) => {
    const { policy, connection, addAccount, approve, access } = setup()
    addAccount('account-a')
    approve()
    expect(access('account-a', changes)).toBe('disabled')
    expect(() => policy.authorize({ ...session, ...changes }, connection.id, catalog, 'read_issue')).toThrow()
  })

  it('keeps write and per-call review policy regardless of wrapper name or tool hints', () => {
    const { policy, connection, addAccount, approve } = setup()
    addAccount('account-a')
    approve()
    expect(policy.authorize(session, connection.id, catalog, 'update_issue')).toMatchObject({
      action: 'write',
      requiresApproval: true,
    })
    for (const name of ['mcp__ramu__read_issue', 'tool_invoke', 'unknown', 'read_issue;update_issue'])
      expect(() => policy.authorize(session, connection.id, catalog, name)).toThrow('outside approved')
    expect(() => policy.authorize(session, 'forged', catalog, 'read_issue')).toThrow('Unknown')
    expect(policy.access(session, connection.id).status).toBe('not-checked')
    expect(policy.access(session, connection.id, 'changed-schema').status).toBe('approval-needed')
  })

  it('cannot broaden an approval to other projects or host-wide access', () => {
    const { policy, connection, addAccount, approve } = setup()
    addAccount('account-a')
    const existing = approve()
    const { id: _id, accountIds: _accounts, shared: _shared, ...reviewed } = existing
    for (const scope of [
      { projectIds: ['project-b'], hostWide: false },
      { projectIds: [], hostWide: true },
    ])
      expect(() => policy.approve({ ...reviewed, accountId: 'account-a', scope })).toThrow('broaden')
    expect(() => policy.approve({ ...reviewed, accountId: 'unknown' })).toThrow('Unknown')
    expect(() => policy.approve({ ...reviewed, accountId: 'account-a', revision: 'stale' })).toThrow('changed')
    expect(policy.snapshot().grants).toHaveLength(1)
    expect(connection.scope).toEqual(input.scope)
  })

  it('host-wide availability still requires explicit host-wide approval for no-project threads', () => {
    const { policy, connection, addAccount, approve, access } = setup()
    policy.saveConnection({ ...input, scope: { projectIds: [], hostWide: true } }, connection.id)
    addAccount('account-a')
    const approved = approve()
    expect(access('account-a', { projectId: null })).toBe('approval-needed')
    const { id: _id, accountIds: _accounts, shared: _shared, ...reviewed } = approved
    policy.approve({ ...reviewed, accountId: 'account-a', scope: { projectIds: [], hostWide: true } })
    expect(access('account-a', { projectId: null })).toBe('approved')
  })

  it('never weakens required approval when grants overlap', () => {
    const { policy, connection, addAccount, approve } = setup()
    addAccount('account-a')
    const approved = approve()
    const { id: _id, accountIds: _accounts, shared: _shared, ...reviewed } = approved
    policy.approve({
      ...reviewed,
      accountId: 'account-a',
      tools: [{ name: 'update_issue', action: 'read', approval: 'connection' }],
    })
    expect(policy.authorize(session, connection.id, catalog, 'update_issue')).toMatchObject({
      action: 'write',
      requiresApproval: true,
    })
  })
})

describe('Shared MCP revision and persistence safety', () => {
  it.each<Partial<Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>>>([
    { serviceAccountId: 'service-bob' },
    { scope: { projectIds: ['project-a', 'project-b'], hostWide: false } },
    { providers: ['claude-code'] as SharedMcpConnection['providers'] },
    { transport: { type: 'http' as const, url: 'https://other.example.test/mcp', headerSecretRefs: {} } },
    {
      transport: {
        type: 'http' as const,
        url: 'https://mcp.example.test/mcp',
        headerSecretRefs: { Authorization: 'new-secret-id' },
      },
    },
  ])('invalidates approvals on security-relevant definition changes %j', (change) => {
    const { policy, connection, addAccount, approve, access } = setup()
    addAccount('account-a')
    approve()
    const changed = policy.saveConnection({ ...input, ...change }, connection.id)
    expect(changed.revision).not.toBe(connection.revision)
    expect(access()).toBe('approval-needed')
    expect(policy.snapshot().grants).toEqual([])
  })

  it('rename and disable preserve stable identity but disabled calls fail immediately', () => {
    const { policy, connection, addAccount, approve, access } = setup()
    addAccount('account-a')
    approve()
    expect(policy.saveConnection({ ...input, name: 'Renamed' }, connection.id).revision).toBe(connection.revision)
    expect(access()).toBe('approved')
    const impersonator = policy.saveConnection(input)
    expect(policy.access(session, impersonator.id, catalog).status).toBe('approval-needed')
    policy.saveConnection({ ...input, enabled: false }, connection.id)
    expect(access()).toBe('disabled')
    policy.saveConnection(input, connection.id)
    expect(access()).toBe('approved')
    policy.removeConnection(connection.id)
    expect(() => policy.authorize(session, connection.id, catalog, 'read_issue')).toThrow('Unknown')
    expect(policy.snapshot().grants).toEqual([])
  })

  it('fails closed on corrupt, cross-host and duplicate persisted state', () => {
    const { policy } = setup()
    const state = policy.snapshot()
    for (const value of [
      { unexpected: true },
      { ...state, connections: [{ ...state.connections[0], hostId: 'host-b' }] },
      { ...state, connections: [...state.connections, ...state.connections] },
    ])
      expect(() => new SharedMcpPolicy('host-a', { load: () => value, save: () => {} })).toThrow()
  })

  it('keeps live approvals unchanged when durable storage fails and returns detached snapshots', () => {
    const { policy, connection, addAccount, approve, access, fail } = setup()
    addAccount('account-a')
    approve()
    const before = policy.snapshot()
    before.connections[0]!.scope.projectIds.push('other')
    before.grants[0]!.accountIds.push('forged')
    expect(access('forged')).toBe('approval-needed')
    expect(access('account-a', { projectId: 'other' })).toBe('disabled')
    fail()
    expect(() => policy.removeConnection(connection.id)).toThrow('Storage locked')
    expect(access()).toBe('approved')
  })

  it('requires safe reference-only configuration and does not accept inline credentials', () => {
    const { policy } = setup()
    for (const url of [
      'http://mcp.example.test',
      'https://user:password@example.test',
      'https://example.test?token=x',
      'https://example.test#secret',
    ])
      expect(() =>
        policy.saveConnection({ ...input, transport: { type: 'http', url, headerSecretRefs: {} } }),
      ).toThrow()
    expect(() =>
      policy.saveConnection({
        ...input,
        transport: { ...input.transport, headers: { Authorization: 'secret' } },
      } as never),
    ).toThrow()
    expect(() =>
      policy.saveConnection({
        ...input,
        transport: { type: 'stdio', command: 'npx untrusted', args: [], cwd: '/workspace', envSecretRefs: {} },
      }),
    ).toThrow()
    expect(() => policy.saveConnection(input, 'unknown')).toThrow('Unknown')
  })

  it('catalog revisions change for schema changes but not object key order', () => {
    expect(sharedMcpCatalogRevision({ name: 'read', schema: { type: 'object', required: ['id'] } })).toBe(
      sharedMcpCatalogRevision({ schema: { required: ['id'], type: 'object' }, name: 'read' }),
    )
    expect(sharedMcpCatalogRevision({ name: 'read', schema: { type: 'string' } })).not.toBe(
      sharedMcpCatalogRevision({ name: 'read', schema: { type: 'number' } }),
    )
  })
})
