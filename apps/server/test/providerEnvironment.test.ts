import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { ProviderEnvironmentStore } from '../src/providers/environmentStore'
import {
  configureProviderAccounts,
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
    new ProviderEnvironmentStore(
      (key, fallback) => (state.get(key) as never) ?? fallback,
      (key, value) => state.set(key, structuredClone(value)),
      credentials,
    )
  return { store, state, secrets }
}

afterEach(() => configureProviderEnvironment({}))

it('keeps values in the credential store, names in app state, and reloads them after a restart', async () => {
  const { store, state, secrets } = setup()
  const first = store()
  await first.load()
  expect(first.status(true)).toMatchObject({ state: 'empty', keys: {} })
  const saved = await first.save({
    global: [{ key: 'HTTPS_PROXY', value: 'http://proxy' }],
    codex: [
      { key: 'OPENAI_BASE_URL', value: 'https://gateway' },
      { key: '', value: '' },
    ],
  })
  expect(saved.keys).toEqual({ global: ['HTTPS_PROXY'], codex: ['OPENAI_BASE_URL'] })
  expect(JSON.stringify([...state.values()])).not.toContain('http://proxy')
  expect(secrets.size).toBe(1)

  // A replacement publishes a new entry and removes the old one.
  await first.save({ global: [{ key: 'HTTPS_PROXY', value: 'http://other' }] })
  expect(secrets.size).toBe(1)

  configureProviderEnvironment({})
  const restarted = store()
  await restarted.load()
  expect(restarted.status(true).values).toEqual({ global: [{ key: 'HTTPS_PROXY', value: 'http://other' }] })
  // Other clients see names only.
  expect(restarted.status(false)).toEqual({
    state: 'available',
    keys: { global: ['HTTPS_PROXY'] },
    canAdminister: false,
  })
  expect(providerEnvironment('codex').HTTPS_PROXY).toBe('http://other')

  await restarted.save({})
  expect(secrets.size).toBe(0)
  expect(restarted.status(true).state).toBe('empty')
})

it('rejects invalid names before storing anything', async () => {
  const { store, secrets } = setup()
  await expect(store().save({ global: [{ key: 'RAMU_TOKEN', value: 'x' }] })).rejects.toThrow(/reserved/)
  await expect(
    store().save({
      global: [
        { key: 'A', value: '1' },
        { key: 'A', value: '2' },
      ],
    }),
  ).rejects.toThrow(/twice/)
  expect(secrets.size).toBe(0)
})

it('reports a locked credential store so Settings can offer a retry', async () => {
  const { store, state } = setup(true)
  state.set('provider-environment', {
    hostId: crypto.randomUUID(),
    reference: crypto.randomUUID(),
    keys: { global: ['X'] },
  })
  const locked = store()
  await locked.load()
  expect(locked.status(true)).toEqual({ state: 'unavailable', keys: { global: ['X'] }, canAdminister: true })
})

it('applies global then provider variables over the shell, without overriding account folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-env-'))
  configureProviderAccounts(root)
  process.env.HTTPS_PROXY = 'shell'
  try {
    configureProviderEnvironment({
      global: [
        { key: 'HTTPS_PROXY', value: 'global' },
        { key: 'CLAUDE_CONFIG_DIR', value: '/elsewhere' },
      ],
      'claude-code': [{ key: 'ANTHROPIC_API_KEY', value: 'chosen' }],
    })
    const config = { 'claude-code': { binary: '', accounts: [{ id: 'work' }] } }
    const work = providerEnvironment('claude-code', config, 'work')
    expect(work.HTTPS_PROXY).toBe('global')
    expect(work.ANTHROPIC_API_KEY).toBe('chosen')
    expect(work.CLAUDE_CONFIG_DIR).toBe(join(root, 'claude-code', 'work'))
    expect(providerEnvironment('codex').ANTHROPIC_API_KEY).toBe(process.env.ANTHROPIC_API_KEY)
  } finally {
    delete process.env.HTTPS_PROXY
  }
})
