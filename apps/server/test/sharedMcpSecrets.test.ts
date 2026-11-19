import { afterEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SharedMcpStorage } from '../src/mcp/storage'
import { SharedMcpService } from '../src/mcp/service'
import { HostCredentialStore } from '../src/credentials/store'
import type { SharedMcpConnection } from '@ramu/shared/mcp'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

function fixture(failWrites = false) {
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const vault = new Map<string, string>()
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value) => {
      if (failWrites && !key.startsWith('probe')) throw new Error('locked')
      vault.set(key, value)
    },
    getPassword: async () => vault.get(key) ?? null,
    deletePassword: async () => vault.delete(key),
  }))
  const service = new SharedMcpService(new SharedMcpStorage(new Workspace(db, '/test/worktrees')), credentials)
  cleanup.push(() => service.close())
  const input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'> = {
    name: 'Local',
    serviceAccountId: 'alice',
    enabled: true,
    providers: ['codex'],
    scope: { hostWide: false, projectIds: ['p'] },
    transport: { type: 'stdio', command: '/bin/echo', args: [], cwd: '/tmp', envSecretRefs: {} },
  }
  return { service, vault, input }
}

const refs = (service: SharedMcpService, id: string) => {
  const { transport } = service.list().connections.find(({ connection }) => connection.id === id)!.connection
  return transport.type === 'stdio' ? transport.envSecretRefs : transport.headerSecretRefs
}

it('stores a secret write-only, replaces it under a new reference and deletes the old value', async () => {
  const { service, vault, input } = fixture()
  const { id } = service.save(input)
  await service.setSecret(id, 'env', 'API_TOKEN', 'first-value')
  const first = refs(service, id).API_TOKEN!
  expect(JSON.stringify(service.list())).not.toContain('first-value')
  expect([...vault.values()]).toContain('first-value')
  await service.setSecret(id, 'env', 'API_TOKEN', 'second-value')
  expect(refs(service, id).API_TOKEN).not.toBe(first)
  expect([...vault.values()].filter((value) => value !== 'ok')).toEqual(['second-value'])
  await service.removeSecret(id, 'env', 'API_TOKEN')
  expect(refs(service, id)).toEqual({})
  expect(vault.size).toBe(0)
})

it('refuses reserved variables and the wrong secret kind', async () => {
  const { service, input } = fixture()
  const { id } = service.save(input)
  await expect(service.setSecret(id, 'env', 'NODE_OPTIONS', 'x')).rejects.toThrow(/not supported/)
  await expect(service.setSecret(id, 'header', 'Authorization', 'x')).rejects.toThrow(/does not take/)
})

it('keeps the working connection when the credential store cannot write', async () => {
  const { service, input } = fixture(true)
  const { id } = service.save(input)
  await expect(service.setSecret(id, 'env', 'API_TOKEN', 'x')).rejects.toThrow(/credential store/)
  expect(refs(service, id)).toEqual({})
})
