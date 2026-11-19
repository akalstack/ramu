import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openDb, type Db } from '../src/db'
import { SharedMcpStorage } from '../src/mcp/storage'
import { SharedMcpPolicy } from '../src/mcp/policy'
import type { ExternalMcpCall } from '../src/mcp/gateway'

const state = (db: Db) => ({
  getAppState: <T>(key: string, fallback: T): T => {
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : fallback
  },
  setAppState: (key: string, value: unknown) => {
    db.prepare(
      'INSERT INTO app_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, JSON.stringify(value))
  },
})
const call = (hostId: string): ExternalMcpCall => ({
  id: randomUUID(),
  sessionId: 'thread',
  hostId,
  connectionId: 'connection',
  serviceAccountId: 'alice',
  provider: 'codex',
  accountId: 'a',
  projectId: 'project',
  revision: '1',
  catalogRevision: '2',
  toolName: 'update_issue',
  action: 'write',
  outcome: 'pending',
})

it('retains host identity and approvals in real SQLite and marks interrupted calls unknown on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-shared-mcp-'))
  let db = openDb(join(directory, 'profile.sqlite'))
  try {
    const storage = new SharedMcpStorage(state(db))
    const policy = new SharedMcpPolicy(storage.hostId, storage)
    const connection = policy.saveConnection({
      name: 'Issues',
      serviceAccountId: 'alice',
      enabled: true,
      scope: { hostWide: true, projectIds: [] },
      providers: ['codex'],
      transport: { type: 'stdio', command: '/test/server', args: [], cwd: '/test', envSecretRefs: {} },
    })
    policy.saveAccount({ provider: 'codex', accountId: 'a', shareApprovals: true })
    policy.approve({
      connectionId: connection.id,
      revision: connection.revision,
      catalogRevision: 'catalog',
      provider: 'codex',
      accountId: 'a',
      scope: connection.scope,
      tools: [{ name: 'read', action: 'read', approval: 'connection' }],
    })
    storage.record(call(storage.hostId))
    db.close()
    db = openDb(join(directory, 'profile.sqlite'))
    const reopened = new SharedMcpStorage(state(db))
    expect(reopened.hostId).toBe(storage.hostId)
    expect(reopened.outcomes()[0]?.outcome).toBe('unknown')
    const resumed = new SharedMcpPolicy(reopened.hostId, reopened)
    expect(
      resumed.authorize(
        {
          hostId: reopened.hostId,
          provider: 'codex',
          accountId: 'a',
          projectId: null,
          role: 'interactive',
          externalToolsAllowed: true,
        },
        connection.id,
        'catalog',
        'read',
      ).requiresApproval,
    ).toBe(false)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('rejects forged and changed outcome identities and does not overwrite settled calls', () => {
  const db = openDb(':memory:')
  try {
    const storage = new SharedMcpStorage(state(db))
    const pending = call(storage.hostId)
    storage.record(pending)
    expect(() => storage.record({ ...pending, serviceAccountId: 'bob' })).toThrow('identity changed')
    expect(() => storage.record({ ...pending, hostId: randomUUID() })).toThrow('another host')
    storage.record({ ...pending, outcome: 'completed' })
    expect(() => storage.record({ ...pending, outcome: 'pending' })).toThrow('already recorded')
    expect(storage.outcomes()[0]?.outcome).toBe('completed')
  } finally {
    db.close()
  }
})
