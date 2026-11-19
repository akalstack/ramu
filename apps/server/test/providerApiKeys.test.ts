import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { ProviderApiKeyStore } from '../src/providers/apiKeyStore'
import {
  configureProviderAccounts,
  configureProviderApiKeys,
  configureProviderEnvironment,
  providerEnvironment,
} from '../src/providers/providerBinaries'

function setup(locked = false) {
  const secrets = new Map<string, string>()
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value: string) => {
      if (locked) throw new Error('locked')
      secrets.set(key, value)
    },
    getPassword: async () => {
      if (locked) throw new Error('locked')
      return secrets.get(key) ?? null
    },
    deletePassword: async () => secrets.delete(key),
  }))
  const state = new Map<string, unknown>()
  const store = () =>
    new ProviderApiKeyStore(
      (key, fallback) => (state.get(key) as never) ?? fallback,
      (key, value) => state.set(key, structuredClone(value)),
      credentials,
    )
  return { store, state, secrets }
}

const config = {
  'claude-code': { binary: '', accounts: [{ id: 'work' }] },
  opencode: { binary: '', accounts: [{ id: 'keys' }] },
}

afterEach(() => {
  configureProviderApiKeys({})
  configureProviderEnvironment({})
})

it('gives a key only to the login it was saved for, and keeps it out of app state', async () => {
  configureProviderAccounts(mkdtempSync(join(tmpdir(), 'ramu-keys-')))
  const { store, state, secrets } = setup()
  const keys = store()
  await keys.load()
  await keys.set('claude-code', 'work', 'ANTHROPIC_API_KEY', '  sk-ant-work  ')
  expect(providerEnvironment('claude-code', config, 'work').ANTHROPIC_API_KEY).toBe('sk-ant-work')
  expect(providerEnvironment('claude-code', config, 'default').ANTHROPIC_API_KEY).toBe(process.env.ANTHROPIC_API_KEY)
  expect(JSON.stringify([...state.values()])).not.toContain('sk-ant-work')
  expect(secrets.size).toBe(1)

  // A restart reads the key back; removing it lets the login use its subscription again.
  configureProviderApiKeys({})
  const restarted = store()
  await restarted.load()
  expect(providerEnvironment('claude-code', config, 'work').ANTHROPIC_API_KEY).toBe('sk-ant-work')
  await restarted.set('claude-code', 'work', 'ANTHROPIC_API_KEY', null)
  expect(providerEnvironment('claude-code', config, 'work').ANTHROPIC_API_KEY).toBeUndefined()
  expect(secrets.size).toBe(0)
})

it("wins over the provider's own variable for that login", async () => {
  configureProviderAccounts(mkdtempSync(join(tmpdir(), 'ramu-keys-')))
  configureProviderEnvironment({ opencode: [{ key: 'OPENROUTER_API_KEY', value: 'shared' }] })
  const { store } = setup()
  const keys = store()
  await keys.load()
  await keys.set('opencode', 'keys', 'OPENROUTER_API_KEY', 'mine')
  expect(providerEnvironment('opencode', config, 'keys').OPENROUTER_API_KEY).toBe('mine')
  expect(providerEnvironment('opencode', config, 'default').OPENROUTER_API_KEY).toBe('shared')
})

it('refuses variables the provider does not use and keys with spaces', async () => {
  const { store, secrets } = setup()
  const keys = store()
  await keys.load()
  await expect(keys.set('claude-code', 'work', 'OPENAI_API_KEY', 'sk-x')).rejects.toThrow(/does not use/)
  await expect(keys.set('claude-code', 'work', 'ANTHROPIC_API_KEY', 'two words')).rejects.toThrow(/valid/)
  await expect(keys.set('antigravity', 'default', 'GEMINI_API_KEY', 'k')).rejects.toThrow(/does not use/)
  expect(secrets.size).toBe(0)
})

it('does not save over keys it could not read from a locked store', async () => {
  const { store, state } = setup(true)
  state.set('provider-api-keys', {
    hostId: crypto.randomUUID(),
    reference: crypto.randomUUID(),
    keys: { codex: { default: 'OPENAI_API_KEY' } },
  })
  const keys = store()
  await keys.load()
  await expect(keys.set('claude-code', 'work', 'ANTHROPIC_API_KEY', 'sk-ant')).rejects.toThrow(/locked/)
})
