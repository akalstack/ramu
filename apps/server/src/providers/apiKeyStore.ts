import { randomUUID } from 'node:crypto'
import { MAX_API_KEY_LENGTH, PROVIDER_KEY_VARIABLES } from '@ramu/shared/providers/apiKeys'
import type { AgentProvider } from '@ramu/shared/types'
import { HostCredentialStore, type HostCredentialScope } from '../credentials/store'
import { configureProviderApiKeys, type ProviderApiKeys } from './providerBinaries'

/** Stored in ordinary app state: which login has a key and in which variable, never the key itself. */
interface ApiKeyIndex {
  hostId: string
  reference?: string
  keys: Partial<Record<AgentProvider, Record<string, string>>>
}

const STATE_KEY = 'provider-api-keys'

/** API keys saved for one login each. Values live as one entry in the host credential store and reach only that
 * login's processes through `providerEnvironment`, so a key never leaks into another account. */
export class ProviderApiKeyStore {
  private values: ProviderApiKeys = {}
  private loaded = false

  constructor(
    private readonly getState: (key: string, fallback: ApiKeyIndex | null) => ApiKeyIndex | null,
    private readonly setState: (key: string, value: ApiKeyIndex) => void,
    private readonly credentials = new HostCredentialStore(),
  ) {}

  private index(): ApiKeyIndex {
    const index = this.getState(STATE_KEY, null)
    if (index?.hostId) return index
    const created = { hostId: randomUUID(), keys: {} }
    this.setState(STATE_KEY, created)
    return created
  }

  private scope(index: ApiKeyIndex): HostCredentialScope {
    return { hostId: index.hostId, integration: 'provider-env', connectionId: 'api-keys', accountId: 'host' }
  }

  async load(): Promise<void> {
    const index = this.index()
    try {
      this.values = index.reference ? JSON.parse(await this.credentials.read(this.scope(index), index.reference)) : {}
      this.loaded = true
    } catch {
      this.values = {}
      this.loaded = false
    }
    configureProviderApiKeys(this.values)
  }

  /** Saves (or with `key` null, removes) one login's key. */
  async set(provider: AgentProvider, accountId: string, variable: string, key: string | null): Promise<void> {
    if (key !== null) {
      if (!PROVIDER_KEY_VARIABLES[provider].includes(variable)) throw new Error('This provider does not use that key')
      if (!key.trim() || key.length > MAX_API_KEY_LENGTH || /\s/.test(key.trim()))
        throw new Error('Enter a valid API key')
    }
    // Saving over keys that could not be read would drop them; a store locked at startup is read again first.
    if (!this.loaded) await this.load()
    if (!this.loaded)
      throw new Error(
        'The host credential store is unavailable or locked. Unlock it on the execution host and try again.',
      )
    const next: ProviderApiKeys = structuredClone(this.values)
    const logins = { ...next[provider] }
    if (key === null) delete logins[accountId]
    else logins[accountId] = { variable, value: key.trim() }
    if (Object.keys(logins).length) next[provider] = logins
    else delete next[provider]
    await this.publish(next)
  }

  private async publish(values: ProviderApiKeys) {
    const index = this.index()
    const empty = !Object.keys(values).length
    const reference = empty ? undefined : await this.credentials.put(this.scope(index), JSON.stringify(values))
    this.setState(STATE_KEY, {
      hostId: index.hostId,
      reference,
      keys: Object.fromEntries(
        Object.entries(values).map(([provider, logins]) => [
          provider,
          Object.fromEntries(Object.entries(logins).map(([id, entry]) => [id, entry.variable])),
        ]),
      ),
    })
    this.values = values
    configureProviderApiKeys(values)
    // The new entry is published; a failed cleanup only leaves an unreferenced credential behind.
    if (index.reference) await this.credentials.remove(this.scope(index), index.reference).catch(() => {})
  }
}
