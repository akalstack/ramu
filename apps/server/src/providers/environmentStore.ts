import { randomUUID } from 'node:crypto'
import {
  ENVIRONMENT_SCOPES,
  MAX_ENVIRONMENT_VARIABLES,
  environmentProblem,
  type EnvironmentScope,
  type ProviderEnvironmentStatus,
  type ProviderEnvironmentValues,
} from '@ramu/shared/providers/environment'
import { HostCredentialStore, type HostCredentialScope } from '../credentials/store'
import { configureProviderEnvironment } from './providerBinaries'

/** Stored in ordinary app state: names and an opaque credential reference, never values. */
interface EnvironmentIndex {
  hostId: string
  reference?: string
  keys: Partial<Record<EnvironmentScope, string[]>>
}

const STATE_KEY = 'provider-environment'

/** Global and per-provider environment variables. Values live as one entry in the host credential store and are
 * applied to every provider process through `providerEnvironment`. */
export class ProviderEnvironmentStore {
  private values: ProviderEnvironmentValues = {}
  private loaded = false
  private loading?: Promise<void>

  constructor(
    private readonly getState: (key: string, fallback: EnvironmentIndex | null) => EnvironmentIndex | null,
    private readonly setState: (key: string, value: EnvironmentIndex) => void,
    private readonly credentials = new HostCredentialStore(),
  ) {}

  private index(): EnvironmentIndex {
    const index = this.getState(STATE_KEY, null)
    if (index?.hostId) return index
    const created = { hostId: randomUUID(), keys: {} }
    this.setState(STATE_KEY, created)
    return created
  }

  private scope(index: EnvironmentIndex): HostCredentialScope {
    return { hostId: index.hostId, integration: 'provider-env', connectionId: 'providers', accountId: 'host' }
  }

  /** Reads values once at startup, and again on retry after the store was locked. */
  load(): Promise<void> {
    return (this.loading ??= this.readValues().finally(() => {
      this.loading = undefined
    }))
  }

  private async readValues() {
    const index = this.index()
    if (!index.reference) {
      this.values = {}
      this.loaded = true
    } else {
      try {
        this.values = JSON.parse(await this.credentials.read(this.scope(index), index.reference))
        this.loaded = true
      } catch {
        this.loaded = false
      }
    }
    configureProviderEnvironment(this.values)
  }

  status(canAdminister: boolean): ProviderEnvironmentStatus {
    const index = this.index()
    const state = !index.reference ? 'empty' : this.loaded ? 'available' : 'unavailable'
    return {
      state,
      keys: index.keys,
      ...(canAdminister && state === 'available' ? { values: this.values } : {}),
      canAdminister,
    }
  }

  async save(input: ProviderEnvironmentValues): Promise<ProviderEnvironmentStatus> {
    const values: ProviderEnvironmentValues = {}
    for (const scope of ENVIRONMENT_SCOPES) {
      const list = (input[scope] ?? []).filter((variable) => variable.key || variable.value)
      if (list.length > MAX_ENVIRONMENT_VARIABLES)
        throw new Error(`Use at most ${MAX_ENVIRONMENT_VARIABLES} variables per provider`)
      for (const variable of list) {
        const problem = environmentProblem(variable, list)
        if (problem) throw new Error(`${variable.key || 'A variable'}: ${problem}`)
      }
      if (list.length) values[scope] = list.map(({ key, value }) => ({ key, value }))
    }
    const index = this.index()
    const empty = !Object.keys(values).length
    const reference = empty ? undefined : await this.credentials.put(this.scope(index), JSON.stringify(values))
    this.setState(STATE_KEY, {
      hostId: index.hostId,
      reference,
      keys: Object.fromEntries(Object.entries(values).map(([scope, list]) => [scope, list.map((v) => v.key)])),
    })
    this.values = values
    this.loaded = true
    configureProviderEnvironment(values)
    // The new entry is published; a failed cleanup only leaves an unreferenced credential behind.
    if (index.reference) await this.credentials.remove(this.scope(index), index.reference).catch(() => {})
    return this.status(true)
  }
}
