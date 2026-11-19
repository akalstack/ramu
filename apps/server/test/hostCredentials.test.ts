import { expect, it, vi } from 'vitest'
import { HostCredentialStore, type HostCredentialScope } from '../src/credentials/store'

const scope: HostCredentialScope = {
  hostId: 'host',
  integration: 'mcp',
  connectionId: 'connection',
  accountId: 'alice',
}
function setup() {
  const values = new Map<string, string>()
  const factory = vi.fn(async (service: string, key: string) => ({
    setPassword: async (value: string) => {
      values.set(`${service}:${key}`, value)
    },
    getPassword: async () => values.get(`${service}:${key}`) ?? null,
    deletePassword: async () => values.delete(`${service}:${key}`),
  }))
  return { store: new HostCredentialStore(factory), values, factory }
}

it('verifies the actual write/read/delete path and leaves no probe credential behind', async () => {
  const { store, values } = setup()
  expect(store.status()).toBe('not-checked')
  await store.verify('host')
  expect(store.status()).toBe('available')
  expect(values.size).toBe(0)
})

it('stores fresh opaque references and isolates hosts, integrations, connections and accounts', async () => {
  const { store, values } = setup()
  const reference = await store.put(scope, 'service-secret')
  expect(reference).not.toContain('service-secret')
  expect(await store.read(scope, reference)).toBe('service-secret')
  for (const change of [
    { hostId: 'other' },
    { integration: 'forge' as const },
    { connectionId: 'other' },
    { accountId: 'bob' },
  ])
    await expect(store.read({ ...scope, ...change }, reference)).rejects.toThrow('unavailable or locked')
  expect(values.size).toBe(1)
  await store.remove(scope, reference)
  await store.remove(scope, reference)
  expect(values.size).toBe(0)
})

it('keeps the working credential when a new write fails and sanitizes native errors', async () => {
  const { store, factory } = setup()
  const previous = await store.put(scope, 'working-secret')
  factory.mockImplementationOnce(async () => {
    throw new Error('native failure with private-value')
  })
  await expect(store.put(scope, 'replacement-secret')).rejects.toThrow('unavailable or locked')
  expect(await store.read(scope, previous)).toBe('working-secret')
})

it('fails verification on a broken readback without claiming the store is available', async () => {
  const deleted = vi.fn(async () => true)
  const store = new HostCredentialStore(async () => ({
    setPassword: async () => {},
    getPassword: async () => 'wrong',
    deletePassword: deleted,
  }))
  await expect(store.verify('host')).rejects.toThrow('unavailable or locked')
  expect(store.status()).toBe('unavailable')
  expect(deleted).toHaveBeenCalledOnce()
})

it('does not access the OS store for invalid references or unbounded credential values', async () => {
  const { store, factory } = setup()
  await expect(store.read(scope, '../../provider-login')).rejects.toThrow('unavailable or locked')
  await expect(store.put(scope, '')).rejects.toThrow('Enter a credential')
  await expect(store.put(scope, 'a'.repeat(65 * 1024))).rejects.toThrow('Enter a credential')
  expect(factory).not.toHaveBeenCalled()
})
