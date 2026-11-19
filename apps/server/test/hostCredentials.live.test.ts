import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'

it.skipIf(process.env.RAMU_TEST_OS_CREDENTIALS !== '1')(
  'round-trips only Ramu-owned test credentials through the native OS store',
  async () => {
    const store = new HostCredentialStore()
    const scope = { hostId: randomUUID(), integration: 'mcp' as const, connectionId: 'acceptance', accountId: 'test' }
    const value = randomUUID()
    await store.verify(scope.hostId)
    const reference = await store.put(scope, value)
    try {
      expect(store.status()).toBe('available')
      expect(await new HostCredentialStore().read(scope, reference)).toBe(value)
    } finally {
      await store.remove(scope, reference)
    }
    await expect(store.read(scope, reference)).rejects.toThrow('unavailable or locked')
  },
)
