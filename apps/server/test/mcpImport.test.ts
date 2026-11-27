import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SharedMcpStorage } from '../src/mcp/storage'
import { SharedMcpService } from '../src/mcp/service'
import { registerProjectSetupHandlers } from '../src/ipc/handlers/projectSetup'
import { registerSharedMcpHandlers } from '../src/ipc/handlers/mcp'
import { MCP_SHARING_KEY, mcpServerKey } from '../src/agent/projectSetup'
import type { HandlerContext } from '../src/ipc/types'
import type { SharedMcpConnection, SharedMcpInspection } from '@ramu/shared/mcp'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

function fixture(declared: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'ramu-import-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: declared }))
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(root, 'trees'))
  const project = workspace.createProject('Fixture', root)
  const sent: string[] = []
  const service = new SharedMcpService(new SharedMcpStorage(workspace))
  cleanup.push(() => service.close())
  const ctx = {
    workspace,
    getSharedMcp: () => service,
    host: { canAdministerIntegrations: () => admin, send: (channel: string) => sent.push(channel) },
  } as unknown as HandlerContext
  let admin = true
  const setup = registerProjectSetupHandlers(ctx)
  const mcp = registerSharedMcpHandlers(ctx)
  const call = (handlers: typeof setup, method: string, ...args: unknown[]) => {
    const entry = handlers[method]!
    return entry.run(...entry.args.parse(args))
  }
  return {
    workspace,
    project,
    root,
    sent,
    service,
    setup: (method: string, ...args: unknown[]) => call(setup, method, ...args),
    mcp: (method: string, ...args: unknown[]) => call(mcp, method, ...args),
    revoke: () => {
      admin = false
    },
  }
}

it('imports a declared remote server as a definition without secrets, connecting nothing, and restores sharing on removal', async () => {
  const { setup, mcp, project, workspace, service } = fixture({
    tracker: { type: 'http', url: 'https://tracker.example/mcp', headers: { Authorization: 'Bearer secret-token' } },
  })
  const declared = (setup('projects.setup', project.id) as { mcp: { key: string; name: string }[] }).mcp.find(
    (entry) => entry.name === 'tracker',
  )!
  const connection = setup('mcp.import', project.id, declared.key) as SharedMcpConnection
  expect(connection).toMatchObject({
    name: 'tracker',
    enabled: true,
    scope: { hostWide: false, projectIds: [project.id] },
    transport: { type: 'http', url: 'https://tracker.example/mcp', headerSecretRefs: {} },
  })
  expect(JSON.stringify(service.list())).not.toContain('secret-token')
  // Nothing is switched off yet: no provider may lose the server before the Shared MCP copy works.
  expect(workspace.getAppState<Record<string, boolean>>(MCP_SHARING_KEY, {})[declared.key]).toBeUndefined()
  const again = (
    setup('projects.setup', project.id) as { mcp: { name: string; managedConnectionId?: string }[] }
  ).mcp.find((entry) => entry.name === 'tracker')!
  expect(again.managedConnectionId).toBe(connection.id)
  expect(() => setup('mcp.import', project.id, declared.key)).toThrow('already connected')
  await mcp('mcp.remove', connection.id)
  expect(workspace.getAppState<Record<string, boolean>>(MCP_SHARING_KEY, {})[declared.key]).toBeUndefined()
})

it('stops sharing the declared copy at the first approval and gives it back when the connection is removed', async () => {
  const path = fileURLToPath(new URL('./fixtures/shared-mcp.mjs', import.meta.url))
  const { setup, mcp, project, workspace } = fixture({ local: { command: process.execPath, args: [path] } })
  const declared = (setup('projects.setup', project.id) as { mcp: { key: string; name: string }[] }).mcp.find(
    (entry) => entry.name === 'local',
  )!
  const sharing = () => workspace.getAppState<Record<string, boolean>>(MCP_SHARING_KEY, {})[declared.key]
  workspace.setAppState(MCP_SHARING_KEY, { [declared.key]: true })
  const connection = setup('mcp.import', project.id, declared.key) as SharedMcpConnection
  expect(sharing()).toBe(true)
  mcp('mcp.account', { provider: 'codex', accountId: 'a', shareApprovals: true })
  const selection = { provider: 'codex', accountId: 'a', projectId: project.id }
  const inspection = (await mcp('mcp.check', connection.id, selection)) as SharedMcpInspection
  mcp('mcp.approve', {
    connectionId: connection.id,
    revision: inspection.revision,
    catalogRevision: inspection.catalogRevision,
    provider: 'codex',
    accountId: 'a',
    scope: connection.scope,
    tools: [{ name: 'inspect_environment', action: 'read', approval: 'connection' }],
  })
  expect(sharing()).toBe(false)
  await mcp('mcp.remove', connection.id)
  expect(sharing()).toBe(true)
})

it('imports a local command with its folder, refuses a relative one, and needs the host administrator', () => {
  const absolute = fixture({
    local: { command: process.execPath, args: ['server.js'], env: { API_KEY: 'secret-key' } },
  })
  const entry = (
    absolute.setup('projects.setup', absolute.project.id) as { mcp: { key: string; name: string }[] }
  ).mcp.find((item) => item.name === 'local')
  const imported = absolute.setup('mcp.import', absolute.project.id, entry!.key) as SharedMcpConnection
  expect(imported.transport).toEqual({
    type: 'stdio',
    command: process.execPath,
    args: ['server.js'],
    cwd: absolute.root,
    envSecretRefs: {},
  })
  expect(JSON.stringify(absolute.service.list())).not.toContain('secret-key')

  const relative = fixture({ local: { command: './bin/server', args: [] } })
  const rel = (
    relative.setup('projects.setup', relative.project.id) as { mcp: { key: string; name: string }[] }
  ).mcp.find((item) => item.name === 'local')
  expect(() => relative.setup('mcp.import', relative.project.id, rel!.key)).toThrow('relative')

  const paired = fixture({ remote: { type: 'http', url: 'https://remote.example/mcp' } })
  const key = mcpServerKey({ type: 'http', url: 'https://remote.example/mcp' })
  paired.revoke()
  expect(() => paired.setup('mcp.import', paired.project.id, key)).toThrow(
    'Change settings over an encrypted connection',
  )
})
