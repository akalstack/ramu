import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { SharedMcpPolicy, type ExternalMcpSession } from '../src/mcp/policy'
import { ExternalMcpGateway, type ExternalMcpCall } from '../src/mcp/gateway'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()))
})

async function fixture() {
  const policy = new SharedMcpPolicy('host', { load: () => undefined, save: () => {} })
  const connection = policy.saveConnection({
    name: 'Project issues',
    serviceAccountId: 'alice',
    enabled: true,
    scope: { hostWide: false, projectIds: ['project'] },
    providers: ['claude-code', 'codex'],
    transport: { type: 'http', url: 'https://issues.example.test/mcp', headerSecretRefs: {} },
  })
  for (const provider of ['claude-code', 'codex'] as const)
    for (const accountId of ['a', 'b']) policy.saveAccount({ provider, accountId, shareApprovals: true })
  const calls: ExternalMcpCall[] = []
  const executions: { name: string; id?: string }[] = []
  const clients: Client[] = []
  const servers: McpServer[] = []
  const approve = vi.fn(async () => true)
  const connect = vi.fn(async () => {
    const server = new McpServer({ name: 'fake-issues', version: 'test' })
    server.registerTool('read_issue', { inputSchema: { id: z.string() } }, ({ id }) => {
      executions.push({ name: 'read_issue', id })
      return { content: [{ type: 'text', text: `Issue ${id}` }], structuredContent: { id } }
    })
    server.registerTool('update_issue', { inputSchema: { id: z.string() } }, ({ id }) => {
      executions.push({ name: 'update_issue', id })
      return { content: [{ type: 'text', text: 'Updated' }] }
    })
    const client = new Client({ name: 'ramu-external-test', version: 'test' })
    const [left, right] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(left), client.connect(right)])
    clients.push(client)
    servers.push(server)
    cleanup.push(() => server.close())
    return client
  })
  const session: ExternalMcpSession = {
    hostId: 'host',
    provider: 'claude-code',
    accountId: 'a',
    projectId: 'project',
    role: 'interactive',
    externalToolsAllowed: true,
  }
  const gateway = (changes: Partial<ExternalMcpSession> = {}) => {
    const value = new ExternalMcpGateway('thread', { ...session, ...changes }, policy, {
      connect,
      approve,
      record: (call) => calls.push(call),
    })
    cleanup.push(() => value.close())
    return value
  }
  const first = gateway()
  const catalog = await first.inspect(connection.id)
  const grant = (provider = session.provider) =>
    policy.approve({
      connectionId: connection.id,
      revision: connection.revision,
      catalogRevision: catalog.catalogRevision,
      provider,
      accountId: 'a',
      scope: connection.scope,
      tools: [
        { name: 'read_issue', action: 'read', approval: 'connection' },
        { name: 'update_issue', action: 'write', approval: 'always' },
      ],
    })
  return { policy, connection, gateway, first, catalog, grant, calls, executions, connect, approve, clients, servers }
}

it('uses real MCP discovery and invocation with the same approved identity across accounts and providers', async () => {
  const { connection, first, catalog, grant, gateway, executions, connect, calls } = await fixture()
  expect((await first.discover(connection.id)).tools).toEqual([])
  grant()
  grant('codex')
  for (const provider of ['claude-code', 'codex'] as const) {
    for (const accountId of ['a', 'b']) {
      const session = gateway({ provider, accountId })
      expect((await session.discover(connection.id)).tools.map((tool) => tool.name)).toEqual([
        'read_issue',
        'update_issue',
      ])
      expect(
        await session.invoke(connection.id, catalog.catalogRevision, 'read_issue', { id: 'RAMU-1' }),
      ).toMatchObject({
        content: [{ type: 'text', text: 'Issue RAMU-1' }],
        structuredContent: { id: 'RAMU-1' },
      })
    }
  }
  expect(executions).toHaveLength(4)
  expect(calls.filter((call) => call.outcome === 'completed')).toHaveLength(4)
  expect(connect.mock.calls).toHaveLength(5) // each session owns its upstream connection
  for (const call of calls) {
    expect(call.serviceAccountId).toBe('alice')
    expect(call).not.toHaveProperty('arguments')
    expect(JSON.stringify(call)).not.toContain('RAMU-1')
  }
})

it('enforces write approval on the server and rechecks revoked grants after approval', async () => {
  const { connection, first, catalog, grant, executions, approve, policy } = await fixture()
  const approved = grant()
  approve.mockResolvedValueOnce(false)
  await expect(first.invoke(connection.id, catalog.catalogRevision, 'update_issue', { id: '1' })).rejects.toThrow(
    'declined',
  )
  expect(executions).toEqual([])
  approve.mockImplementationOnce(async () => {
    policy.revoke(approved.id)
    return true
  })
  await expect(first.invoke(connection.id, catalog.catalogRevision, 'update_issue', { id: '1' })).rejects.toThrow(
    'Review',
  )
  expect(executions).toEqual([])
})

it('rejects restricted, wrong-project and thread-narrowed sessions before connecting upstream', async () => {
  const { connection, gateway, grant, catalog, connect } = await fixture()
  grant()
  const count = connect.mock.calls.length
  for (const change of [{ role: 'restricted' as const }, { projectId: 'other' }, { connectionIds: [] }]) {
    const session = gateway(change)
    await expect(session.discover(connection.id)).rejects.toThrow()
    await expect(session.invoke(connection.id, catalog.catalogRevision, 'read_issue', { id: '1' })).rejects.toThrow()
  }
  expect(connect.mock.calls).toHaveLength(count)
})

it('invalidates a changed catalog before executing any previously approved tool', async () => {
  const { connection, first, catalog, grant, executions, servers } = await fixture()
  grant()
  servers[0]!.registerTool('new_tool', { inputSchema: {} }, () => ({ content: [] }))
  await expect(first.invoke(connection.id, catalog.catalogRevision, 'read_issue', { id: '1' })).rejects.toThrow(
    'changed',
  )
  expect(executions).toEqual([])
  expect((await first.discover(connection.id)).tools).toEqual([])
})

it('rechecks upstream schemas after a delayed approval', async () => {
  const { connection, first, catalog, grant, executions, servers, approve } = await fixture()
  grant()
  approve.mockImplementationOnce(async () => {
    servers[0]!.registerTool('new_tool', { inputSchema: {} }, () => ({ content: [] }))
    return true
  })
  await expect(first.invoke(connection.id, catalog.catalogRevision, 'update_issue', { id: '1' })).rejects.toThrow(
    'changed during approval',
  )
  expect(executions).toEqual([])
})

it('rejects invalid arguments without running the upstream operation', async () => {
  const { connection, first, catalog, grant, executions, calls } = await fixture()
  grant()
  const result = await first.invoke(connection.id, catalog.catalogRevision, 'read_issue', { id: 12 })
  expect(result.isError).toBe(true)
  expect(executions).toEqual([])
  expect(calls.at(-1)?.outcome).toBe('tool-error')
})

it('records lost write responses as unknown, sanitizes errors and never retries', async () => {
  const { connection, first, catalog, grant, calls, clients, approve } = await fixture()
  grant()
  const dispatch = vi.spyOn(clients[0]!, 'callTool').mockRejectedValueOnce(new Error('Bearer private-secret'))
  await expect(first.invoke(connection.id, catalog.catalogRevision, 'update_issue', { id: '1' })).rejects.toThrow(
    'outcome is unknown',
  )
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(approve).toHaveBeenCalledTimes(1)
  expect(calls.map((call) => call.outcome)).toEqual(['pending', 'unknown'])
  expect(JSON.stringify(calls)).not.toContain('private-secret')
})

it('does not dispatch if outcome recording fails before the write', async () => {
  const { connection, catalog, grant, policy, connect, approve, executions } = await fixture()
  grant()
  const session: ExternalMcpSession = {
    hostId: 'host',
    provider: 'claude-code',
    accountId: 'a',
    projectId: 'project',
    role: 'interactive',
    externalToolsAllowed: true,
  }
  const gateway = new ExternalMcpGateway('thread', session, policy, {
    connect,
    approve,
    record: () => {
      throw new Error('Disk full')
    },
  })
  cleanup.push(() => gateway.close())
  await expect(gateway.invoke(connection.id, catalog.catalogRevision, 'update_issue', { id: '1' })).rejects.toThrow(
    'Disk full',
  )
  expect(executions).toEqual([])
})

it('cancels approval without sending the write and rejects use after session close', async () => {
  const { connection, first, catalog, grant, executions, approve } = await fixture()
  grant()
  const abort = new AbortController()
  approve.mockImplementationOnce(async () => {
    abort.abort()
    return true
  })
  await expect(
    first.invoke(connection.id, catalog.catalogRevision, 'update_issue', { id: '1' }, abort.signal),
  ).rejects.toThrow()
  expect(executions).toEqual([])
  await first.close()
  await expect(first.discover(connection.id)).rejects.toThrow('closed')
})

it('bounds and validates paginated catalogs through the real SDK protocol', async () => {
  const policy = new SharedMcpPolicy('host', { load: () => undefined, save: () => {} })
  const connection = policy.saveConnection({
    name: 'Paged service',
    serviceAccountId: 'alice',
    enabled: true,
    scope: { hostWide: true, projectIds: [] },
    providers: ['codex'],
    transport: { type: 'http', url: 'https://example.test/mcp', headerSecretRefs: {} },
  })
  policy.saveAccount({ provider: 'codex', accountId: 'a', shareApprovals: true })
  const server = new Server({ name: 'paged', version: 'test' }, { capabilities: { tools: {} } })
  let repeat = false
  const read: Tool = { name: 'read', inputSchema: { type: 'object' } }
  server.setRequestHandler(ListToolsRequestSchema, (request) =>
    request.params?.cursor
      ? { tools: repeat ? [] : [{ ...read, name: 'second' }], ...(repeat ? { nextCursor: 'page2' } : {}) }
      : { tools: [read], nextCursor: 'page2' },
  )
  server.setRequestHandler(CallToolRequestSchema, () => ({ content: [] }))
  const client = new Client({ name: 'test', version: 'test' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  const gateway = new ExternalMcpGateway(
    'thread',
    {
      hostId: 'host',
      provider: 'codex',
      accountId: 'a',
      projectId: null,
      role: 'interactive',
      externalToolsAllowed: true,
    },
    policy,
    { connect: async () => client, approve: async () => false, record: () => {} },
  )
  cleanup.push(
    () => server.close(),
    () => gateway.close(),
  )
  expect((await gateway.inspect(connection.id)).tools.map((tool) => tool.name)).toEqual(['read', 'second'])
  repeat = true
  await expect(gateway.inspect(connection.id)).rejects.toThrow('repeated')
})
