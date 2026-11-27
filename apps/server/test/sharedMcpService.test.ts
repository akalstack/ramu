import { noteRuntimeTransports } from '../src/providers/runtimeTransports'
import { afterEach, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SharedMcpStorage } from '../src/mcp/storage'
import { SharedMcpService } from '../src/mcp/service'
import { connectSharedMcpStdio } from '../src/mcp/stdio'
import { registerSharedMcpHandlers } from '../src/ipc/handlers/mcp'
import type { HandlerContext } from '../src/ipc/types'
import type { SharedMcpConnection, SharedMcpInspection, SharedMcpManagement } from '@ramu/shared/mcp'
import { deviceMayInvoke } from '../src/remote/access'
import { HostCredentialStore } from '../src/credentials/store'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
function fixture() {
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, '/test/worktrees')
  const connect = vi.fn((connection, _session, signal) => connectSharedMcpStdio(connection, signal))
  const changed = vi.fn()
  const manager = new SharedMcpService(new SharedMcpStorage(workspace), undefined, changed, connect)
  cleanup.push(() => manager.close())
  let local = true
  const handlers = registerSharedMcpHandlers({
    getSharedMcp: () => manager,
    workspace,
    host: { canAdministerIntegrations: () => local },
  } as unknown as HandlerContext)
  const invoke = (method: string, ...args: unknown[]) => {
    const entry = handlers[method]!
    return entry.run(...entry.args.parse(args))
  }
  const path = fileURLToPath(new URL('./fixtures/shared-mcp.mjs', import.meta.url))
  const input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'> = {
    name: 'Shared local service',
    serviceAccountId: 'alice',
    enabled: true,
    providers: ['claude-code', 'codex'],
    scope: { hostWide: false, projectIds: ['project'] },
    transport: { type: 'stdio', command: process.execPath, args: [path], cwd: dirname(path), envSecretRefs: {} },
  }
  const status = () => invoke('mcp.status') as SharedMcpManagement & { canAdminister: boolean }
  return {
    manager,
    invoke,
    connect,
    input,
    status,
    changed,
    remote: () => {
      local = false
    },
  }
}

it('saves without execution, explicitly checks and approves actual tools, and reuses access across accounts', async () => {
  const { invoke, connect, manager, input, status } = fixture()
  const connection = invoke('mcp.save', input) as SharedMcpConnection
  expect(connect).not.toHaveBeenCalled()
  expect(status().connections[0]?.status).toBe('not-connected')
  for (const accountId of ['a', 'b']) invoke('mcp.account', { provider: 'codex', accountId, shareApprovals: true })
  const selection = { provider: 'codex' as const, accountId: 'a', projectId: 'project' }
  const inspection = (await invoke('mcp.check', connection.id, selection)) as SharedMcpInspection
  expect(status().connections[0]).toMatchObject({ status: 'connected', toolCount: 1 })
  expect(inspection.tools[0]?.name).toBe('inspect_environment')
  const reviewed = {
    connectionId: connection.id,
    revision: inspection.revision,
    catalogRevision: inspection.catalogRevision,
    provider: 'codex',
    accountId: 'a',
    scope: input.scope,
    tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
  }
  expect(() => invoke('mcp.approve', { ...reviewed, catalogRevision: 'forged' })).toThrow('current tools')
  expect(() =>
    invoke('mcp.approve', { ...reviewed, tools: [{ name: 'forged', action: 'read', approval: 'connection' }] }),
  ).toThrow('current tools')
  invoke('mcp.approve', reviewed)
  const gateway = manager.gateway(
    'thread',
    { ...selection, hostId: status().hostId, accountId: 'b', role: 'interactive', externalToolsAllowed: true },
    async () => false,
  )
  cleanup.push(() => gateway.close())
  expect((await gateway.discover(connection.id)).tools[0]?.name).toBe('inspect_environment')
  expect((await gateway.invoke(connection.id, inspection.catalogRevision, 'inspect_environment', {})).isError).not.toBe(
    true,
  )
  await invoke('mcp.disconnect', connection.id)
  await expect(gateway.invoke(connection.id, inspection.catalogRevision, 'inspect_environment', {})).rejects.toThrow(
    'Review',
  )
  expect(status().connections[0]?.status).toBe('not-connected')
  await invoke('mcp.remove', connection.id)
  expect(status().connections).toEqual([])
})

it('lets paired clients read safe status but denies every administration operation on the server', async () => {
  const { invoke, remote, status, input } = fixture()
  const connection = invoke('mcp.save', input) as SharedMcpConnection
  remote()
  expect(status().canAdminister).toBe(false)
  for (const [method, args] of [
    ['mcp.save', [input]],
    ['mcp.account', [{ provider: 'codex', accountId: 'a', shareApprovals: true }]],
    ['mcp.check', [connection.id, { provider: 'codex', accountId: 'a', projectId: 'project' }]],
    ['mcp.disconnect', [connection.id]],
    ['mcp.remove', [connection.id]],
    ['mcp.checkCredentialStore', []],
  ] as const)
    await expect(Promise.resolve().then(() => invoke(method, ...args))).rejects.toThrow(
      'Change settings over an encrypted connection',
    )
  const viewer = {
    id: 'viewer',
    name: 'Phone',
    role: 'viewer' as const,
    createdAt: 0,
    lastSeenAt: null,
    expiresAt: null,
  }
  expect(deviceMayInvoke(viewer, 'mcp.status')).toBe(true)
  for (const method of [
    'mcp.save',
    'mcp.account',
    'mcp.check',
    'mcp.approve',
    'mcp.disconnect',
    'mcp.remove',
    'mcp.checkCredentialStore',
  ])
    expect(deviceMayInvoke(viewer, method)).toBe(false)
  expect(status().connections).toHaveLength(1)
})

it('cannot approve a previously inspected catalog after editing its connection', async () => {
  const { invoke, input } = fixture()
  const connection = invoke('mcp.save', input) as SharedMcpConnection
  invoke('mcp.account', { provider: 'codex', accountId: 'a', shareApprovals: true })
  const inspection = (await invoke('mcp.check', connection.id, {
    provider: 'codex',
    accountId: 'a',
    projectId: 'project',
  })) as SharedMcpInspection
  invoke('mcp.save', { ...input, serviceAccountId: 'bob' }, connection.id)
  expect(() =>
    invoke('mcp.approve', {
      connectionId: connection.id,
      revision: inspection.revision,
      catalogRevision: inspection.catalogRevision,
      provider: 'codex',
      accountId: 'a',
      scope: input.scope,
      tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
    }),
  ).toThrow('current tools')
})

it('checks HTTP through the isolated connection factory and sanitizes a failed setup', async () => {
  const { invoke, input, status, connect } = fixture()
  const connection = invoke('mcp.save', {
    ...input,
    transport: { type: 'http', url: 'https://example.test/mcp', headerSecretRefs: {} },
  }) as SharedMcpConnection
  invoke('mcp.account', { provider: 'codex', accountId: 'a', shareApprovals: true })
  await expect(
    invoke('mcp.check', connection.id, { provider: 'codex', accountId: 'a', projectId: 'project' }),
  ).rejects.toThrow('server URL')
  expect(status().connections[0]?.status).toBe('failed')
  expect(connect).toHaveBeenCalledOnce()
})

it('retains a removable definition when credential cleanup fails and clears only its own references on retry', async () => {
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const storage = new SharedMcpStorage(new Workspace(db, '/unused'))
  const values = new Map<string, string>()
  let locked = false
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value) => {
      values.set(key, value)
    },
    getPassword: async () => values.get(key) ?? null,
    deletePassword: async () => {
      if (locked) throw new Error('locked with private data')
      return values.delete(key)
    },
  }))
  const manager = new SharedMcpService(storage, credentials)
  cleanup.push(() => manager.close())
  const connection = manager.save({
    name: 'Account cleanup',
    serviceAccountId: 'alice',
    enabled: true,
    providers: ['codex'],
    scope: { hostWide: true, projectIds: [] },
    transport: { type: 'http', url: 'https://example.test/mcp', headerSecretRefs: {} },
  })
  const scope = { hostId: storage.hostId, integration: 'mcp' as const, connectionId: connection.id, accountId: 'alice' }
  const reference = await credentials.put(scope, 'service-test-secret')
  const { id, hostId: _host, revision: _revision, ...definition } = connection
  manager.save(
    {
      ...definition,
      transport: { type: 'http', url: 'https://example.test/mcp', headerSecretRefs: { Authorization: reference } },
    },
    id,
  )
  locked = true
  await expect(manager.remove(id)).rejects.toThrow('unavailable or locked')
  expect(manager.list().connections).toHaveLength(1)
  expect(values.size).toBe(1)
  locked = false
  await manager.remove(id)
  expect(manager.list().connections).toEqual([])
  expect(values.size).toBe(0)
})

it('reports each login as not checked, approval needed or ready, and nothing without a connection', async () => {
  const { invoke, input, status } = fixture()
  for (const accountId of ['a', 'b'])
    invoke('mcp.account', { provider: 'codex', accountId, shareApprovals: accountId === 'a' })
  const readiness = (accountId: string) => status().readiness?.find((entry) => entry.accountId === accountId)
  expect(readiness('a')).toBeUndefined()
  const connection = invoke('mcp.save', input) as SharedMcpConnection
  expect(readiness('a')).toMatchObject({ status: 'not-checked', checkedAt: null })
  const selection = { provider: 'codex' as const, accountId: 'a', projectId: 'project' }
  const inspection = (await invoke('mcp.check', connection.id, selection)) as SharedMcpInspection
  expect(readiness('a')).toMatchObject({ status: 'approval-needed' })
  invoke('mcp.approve', {
    connectionId: connection.id,
    revision: inspection.revision,
    catalogRevision: inspection.catalogRevision,
    provider: 'codex',
    accountId: 'a',
    scope: input.scope,
    tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
  })
  expect(readiness('a')).toMatchObject({ status: 'ready', checkedAt: inspection.checkedAt })
  // b did not opt in to sharing, so the grant is not its approval.
  expect(readiness('b')?.status).toBe('approval-needed')
  const again = (await invoke('mcp.recheckAccount', 'codex', 'a', 'project')) as { accountId: string; status: string }[]
  expect(again.find((entry) => entry.accountId === 'a')?.status).toBe('ready')
  await expect(invoke('mcp.recheckAccount', 'codex', 'missing', null)).rejects.toThrow('Unknown provider account')
})

it('reports a runtime that said it has no HTTP MCP as unsupported, with that reason, until it says otherwise', () => {
  const { invoke, input, status } = fixture()
  invoke('mcp.account', { provider: 'codex', accountId: 'a', shareApprovals: true })
  invoke('mcp.save', input)
  noteRuntimeTransports('codex', { http: false })
  try {
    expect(status().readiness?.[0]).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('HTTP MCP'),
    })
    noteRuntimeTransports('codex', { http: true })
    expect(status().readiness?.[0]?.status).toBe('not-checked')
  } finally {
    noteRuntimeTransports('codex', undefined)
  }
})

it('stores a credential write-only, replaces it without losing the old one on failure, and drops it on an account change', async () => {
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const storage = new SharedMcpStorage(new Workspace(db, '/unused'))
  const values = new Map<string, string>()
  let locked = false
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value) => {
      if (locked) throw new Error('locked')
      values.set(key, value)
    },
    getPassword: async () => values.get(key) ?? null,
    deletePassword: async () => values.delete(key),
  }))
  const manager = new SharedMcpService(storage, credentials)
  cleanup.push(() => manager.close())
  const connection = manager.save({
    name: 'Keyed',
    serviceAccountId: 'alice',
    enabled: true,
    providers: ['codex'],
    scope: { hostWide: true, projectIds: [] },
    transport: { type: 'http', url: 'https://example.test/mcp', headerSecretRefs: {} },
  })
  await manager.setCredential(connection.id, 'Authorization', 'first-secret')
  const saved = () => manager.list().connections[0]!.connection
  const refs = () => (saved().transport as { headerSecretRefs: Record<string, string> }).headerSecretRefs
  const firstRef = refs().Authorization
  expect([...values.values()]).toEqual(['first-secret'])
  expect(JSON.stringify(manager.list())).not.toContain('first-secret')
  locked = true
  await expect(manager.setCredential(connection.id, 'Authorization', 'second-secret')).rejects.toThrow('unavailable')
  locked = false
  expect(refs().Authorization).toBe(firstRef)
  expect([...values.values()]).toEqual(['first-secret'])
  await manager.setCredential(connection.id, 'Authorization', 'second-secret')
  expect([...values.values()]).toEqual(['second-secret'])
  const { id, hostId: _host, revision: _revision, ...definition } = saved()
  manager.save({ ...definition, serviceAccountId: 'bob' }, id)
  await vi.waitFor(() => expect(values.size).toBe(0))
  expect(refs()).toEqual({})
})

it('names what a destination login still lacks without checking unreviewed connections, and rechecks reviewed ones', async () => {
  const { invoke, input, connect, manager } = fixture()
  const connection = invoke('mcp.save', input) as SharedMcpConnection
  invoke('mcp.account', { provider: 'codex', accountId: 'a', shareApprovals: true })
  invoke('mcp.account', { provider: 'codex', accountId: 'b', shareApprovals: true })
  expect(await manager.destinationAttention('codex', 'b', 'project')).toEqual([
    { name: 'Shared local service', status: 'not-checked', connectionId: connection.id },
  ])
  expect(connect).not.toHaveBeenCalled()
  const inspection = (await invoke('mcp.check', connection.id, {
    provider: 'codex',
    accountId: 'a',
    projectId: 'project',
  })) as SharedMcpInspection
  invoke('mcp.approve', {
    connectionId: connection.id,
    revision: inspection.revision,
    catalogRevision: inspection.catalogRevision,
    provider: 'codex',
    accountId: 'a',
    scope: input.scope,
    tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
  })
  expect(await manager.destinationAttention('codex', 'b', 'project')).toEqual([])
  expect(await manager.destinationAttention('codex', 'b', 'other-project')).toEqual([])
})

it('turns a server on for every login in one step, each tool asking unless the person lets it run', async () => {
  const { invoke, manager, input } = fixture()
  const connection = invoke('mcp.save', { ...input, scope: { hostWide: true, projectIds: [] } }) as SharedMcpConnection
  const logins = [
    { provider: 'codex', accountId: 'a' },
    { provider: 'codex', accountId: 'b' },
    { provider: 'claude-code', accountId: 'default' },
    // A provider the server is not set up for gets nothing.
    { provider: 'cursor', accountId: 'default' },
  ]
  await invoke('mcp.turnOn', connection.id, logins)
  const grants = () => manager.policy.snapshot().grants.filter((grant) => grant.connectionId === connection.id)
  expect(
    grants()
      .map((grant) => `${grant.provider}:${grant.accountIds.join(',')}`)
      .sort(),
  ).toEqual(['claude-code:default', 'codex:a', 'codex:b'])
  // The fixture's tool makes no read-only claim, so it asks on every call.
  expect(grants()[0]!.tools).toEqual([{ name: 'inspect_environment', action: 'write', approval: 'always' }])
  await invoke('mcp.turnOn', connection.id, logins.slice(0, 1), { inspect_environment: 'allow' })
  expect(grants().find((grant) => grant.accountIds.includes('a'))!.tools[0]!.approval).toBe('connection')
  await expect(invoke('mcp.turnOn', connection.id, logins, { inspect_environment: 'off' })).rejects.toThrow(
    'Leave at least one tool on',
  )
})
