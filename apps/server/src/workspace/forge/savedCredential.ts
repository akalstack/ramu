// A hosting credential saved for one service on this host. The secret stays in the host credential store; ordinary
// state keeps only a reference and one non-secret field Settings may show (an account email, an organization).
import { randomUUID } from 'node:crypto'
import { HostCredentialStore, type HostCredentialScope } from '../../credentials/store'

/** The shown field is stored under its own name, e.g. `email`. */
interface Index {
  hostId: string
  reference?: string
  [shown: string]: string | undefined
}

export class SavedCredential<T extends { token: string }> {
  private cached?: T | null
  constructor(
    /** App-state key for the index, and the credential store's connection id. */
    private readonly service: { key: string; connectionId: string; shown: keyof T & string },
    private readonly getState: (key: string, fallback: Index | null) => Index | null,
    private readonly setState: (key: string, value: Index) => void,
    private readonly credentials = new HostCredentialStore(),
  ) {}

  private index(): Index {
    const index = this.getState(this.service.key, null)
    if (index?.hostId) return index
    const created = { hostId: randomUUID() }
    this.setState(this.service.key, created)
    return created
  }

  private scope(index: Index): HostCredentialScope {
    return { hostId: index.hostId, integration: 'forge', connectionId: this.service.connectionId, accountId: 'host' }
  }

  /** Whether one is saved, with its shown field, without reading the secret. */
  savedField(): { shown: string | null } | null {
    const index = this.index()
    return index.reference ? { shown: index[this.service.shown] ?? null } : null
  }

  async read(): Promise<T | null> {
    if (this.cached !== undefined) return this.cached
    const index = this.index()
    if (!index.reference) return (this.cached = null)
    return (this.cached = JSON.parse(await this.credentials.read(this.scope(index), index.reference)) as T)
  }

  async save(value: T): Promise<void> {
    const index = this.index()
    const reference = await this.credentials.put(this.scope(index), JSON.stringify(value))
    const shown = value[this.service.shown]
    this.setState(this.service.key, {
      hostId: index.hostId,
      reference,
      ...(typeof shown === 'string' && shown ? { [this.service.shown]: shown } : {}),
    })
    this.cached = value
    if (index.reference) await this.credentials.remove(this.scope(index), index.reference).catch(() => {})
  }

  async remove(): Promise<void> {
    const index = this.index()
    this.setState(this.service.key, { hostId: index.hostId })
    this.cached = null
    if (index.reference) await this.credentials.remove(this.scope(index), index.reference).catch(() => {})
  }
}
