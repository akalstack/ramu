import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SharedMcpStorage } from '../src/mcp/storage'
import { SharedMcpService } from '../src/mcp/service'
import { connectSharedMcpStdio } from '../src/mcp/stdio'
import {
  ExternalSessionTools,
  connectionsUsed,
  externalToolName,
  hasExternalConnections,
  type ExternalSessionSource,
} from '../src/mcp/sessionTools'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

it('names tools deterministically, within the provider limit, and never merges same-named servers', () => {
  const a = externalToolName({ id: 'one', name: 'Atlassian' }, 'search issues')
  expect(a).toBe(externalToolName({ id: 'one', name: 'Atlassian' }, 'search issues'))
  expect(a).not.toBe(externalToolName({ id: 'two', name: 'Atlassian' }, 'search issues'))
  expect(externalToolName({ id: 'one', name: 'x' }, 'a b')).not.toBe(externalToolName({ id: 'one', name: 'x' }, 'a_b'))
  const long = externalToolName({ id: 'one', name: 'A very long connection name' }, 't'.repeat(200))
  expect(`mcp__shared_mcp__${long}`.length).toBeLessThanOrEqual(64)
  expect(long).toMatch(/^[A-Za-z0-9_-]+$/)
})

function fixture() {
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, '/test/trees')
  const service = new SharedMcpService(
    new SharedMcpStorage(workspace),
    undefined,
    () => {},
    (connection, _session, signal) => connectSharedMcpStdio(connection, signal),
  )
  cleanup.push(() => service.close())
  const path = fileURLToPath(new URL('./fixtures/shared-mcp.mjs', import.meta.url))
  const connection = service.save({
    name: 'Fixture',
    serviceAccountId: 'alice',
    enabled: true,
    providers: ['codex'],
    scope: { hostWide: false, projectIds: ['project'] },
    transport: { type: 'stdio', command: process.execPath, args: [path], cwd: dirname(path), envSecretRefs: {} },
  })
  service.saveAccount({ provider: 'codex', accountId: 'a', shareApprovals: true })
  const source: ExternalSessionSource = {
    sessionId: 'thread',
    hostId: service.storage.hostId,
    provider: 'codex',
    accountId: 'a',
    projectId: 'project',
    role: 'interactive',
    externalToolsAllowed: true,
  }
  const tools = new ExternalSessionTools(
    () => service,
    async () => true,
  )
  cleanup.push(() => tools.close())
  return { service, connection, source, tools }
}

it('lists nothing until a reviewed approval exists, then lists only approved tools', async () => {
  const { service, connection, source, tools } = fixture()
  expect(hasExternalConnections(service, source)).toBe(true)
  expect(await tools.list(source)).toEqual([])
  const inspection = await service.check(connection.id, { provider: 'codex', accountId: 'a', projectId: 'project' })
  service.approve({
    connectionId: connection.id,
    revision: inspection.revision,
    catalogRevision: inspection.catalogRevision,
    provider: 'codex',
    accountId: 'a',
    scope: connection.scope,
    tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
  })
  const listed = await tools.list(source)
  expect(listed.map((entry) => entry.tool.name)).toEqual(['inspect_environment'])
  expect(listed[0]!.name).toContain('inspect_environment')
  expect(await tools.list({ ...source, sessionId: 'other-thread', projectId: 'other' })).toEqual([])
})

it('offers external tools to no restricted, helper or out-of-scope session', () => {
  const { service, source } = fixture()
  expect(hasExternalConnections(service, { ...source, role: 'restricted' })).toBe(false)
  expect(hasExternalConnections(service, { ...source, externalToolsAllowed: false })).toBe(false)
  expect(hasExternalConnections(service, { ...source, projectId: null })).toBe(false)
  expect(hasExternalConnections(service, { ...source, provider: 'claude-code' })).toBe(false)
  expect(hasExternalConnections(service, { ...source, connectionIds: [] })).toBe(false)
})

it('queues parallel calls on one connection instead of rejecting the second', async () => {
  const { service, connection, source } = fixture()
  const inspection = await service.check(connection.id, { provider: 'codex', accountId: 'a', projectId: 'project' })
  service.approve({
    connectionId: connection.id,
    revision: inspection.revision,
    catalogRevision: inspection.catalogRevision,
    provider: 'codex',
    accountId: 'a',
    scope: connection.scope,
    tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
  })
  const gateway = service.gateway(
    'parallel',
    { ...source, hostId: service.storage.hostId, externalToolsAllowed: true },
    async () => true,
  )
  cleanup.push(() => gateway.close())
  const results = await Promise.all(
    [1, 2, 3].map(() => gateway.invoke(connection.id, inspection.catalogRevision, 'inspect_environment', {})),
  )
  expect(results.map((result) => result.isError)).toEqual([undefined, undefined, undefined])
})

describe('connectionsUsed', () => {
  it('recognizes a thread’s calls to a connection whatever provider prefix the tool name carries', () => {
    const tracker = { id: 'conn-tracker-1', name: 'Tracker' }
    const wiki = { id: 'conn-wiki-2', name: 'Wiki' }
    const used = [`mcp__shared_mcp__${externalToolName(tracker, 'create_issue')}`, 'shared_mcp.search', 'Read']
    expect([...connectionsUsed(used, [tracker.id, wiki.id])]).toEqual([tracker.id])
    expect(connectionsUsed([], [tracker.id]).size).toBe(0)
  })
})
