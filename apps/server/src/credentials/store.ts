import { createHash, randomUUID } from 'node:crypto'

export interface HostCredentialScope {
  hostId: string
  integration: 'mcp' | 'forge' | 'provider-env' | 'host-pairing' | 'link'
  connectionId: string
  accountId: string
}

interface CredentialEntry {
  setPassword(value: string, signal?: AbortSignal): Promise<void>
  getPassword(signal?: AbortSignal): Promise<string | null>
  deletePassword(signal?: AbortSignal): Promise<boolean>
}
type EntryFactory = (service: string, key: string) => Promise<CredentialEntry>

const nativeEntry: EntryFactory = async (service, key) => {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  // A persistent Secret Service must be explicitly available on Linux. Do not silently
  // select the kernel keyring, which has different persistence/session semantics.
  return new AsyncEntry(service, key, { linux: { store: 'secret-service' } })
}
const service = 'app.ramu.host-credentials.v1'
const referencePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const safeError = () =>
  new Error('The host credential store is unavailable or locked. Unlock it on the execution host and try again.')

/** OS-backed, host-owned credential storage shared by MCP, Git hosting and provider environment variables.
 * Only opaque references enter SQLite/settings. No native errors or values are returned in status.
 * A replacement gets a new reference; callers publish it only after validating the new connection. */
export class HostCredentialStore {
  private state: 'not-checked' | 'available' | 'unavailable' = 'not-checked'
  private checking?: Promise<void>

  constructor(private readonly factory: EntryFactory = nativeEntry) {}

  status() {
    return this.state
  }

  private entry(scope: HostCredentialScope, reference: string) {
    if (
      !referencePattern.test(reference) ||
      !['mcp', 'forge', 'provider-env', 'host-pairing', 'link'].includes(scope.integration) ||
      [scope.hostId, scope.connectionId, scope.accountId].some((value) => !value || value.length > 200)
    )
      throw new Error('Invalid host credential reference or scope')
    const key = createHash('sha256')
      .update(JSON.stringify([scope.hostId, scope.integration, scope.connectionId, scope.accountId, reference]))
      .digest('hex')
    return this.factory(service, key)
  }

  /** Explicit setup/check performs a write/read/delete round trip, not an availability guess. */
  async verify(hostId: string): Promise<void> {
    if (this.checking) return this.checking
    this.checking = this.probe(hostId).finally(() => {
      this.checking = undefined
    })
    return this.checking
  }

  private async probe(hostId: string) {
    const reference = randomUUID()
    const value = randomUUID()
    let entry: CredentialEntry | undefined
    try {
      entry = await this.entry(
        { hostId, integration: 'mcp', connectionId: 'credential-store-check', accountId: 'check' },
        reference,
      )
      await entry.setPassword(value, AbortSignal.timeout(10_000))
      if ((await entry.getPassword(AbortSignal.timeout(10_000))) !== value) throw new Error('Readback failed')
      await entry.deletePassword(AbortSignal.timeout(10_000))
      this.state = 'available'
    } catch {
      this.state = 'unavailable'
      await entry?.deletePassword(AbortSignal.timeout(10_000)).catch(() => {})
      throw safeError()
    }
  }

  async put(scope: HostCredentialScope, value: string): Promise<string> {
    if (!value || Buffer.byteLength(value) > 64 * 1024) throw new Error('Enter a credential of at most 64 KB')
    if (this.state !== 'available') await this.verify(scope.hostId)
    const reference = randomUUID()
    let entry: CredentialEntry | undefined
    try {
      entry = await this.entry(scope, reference)
      await entry.setPassword(value, AbortSignal.timeout(10_000))
      if ((await entry.getPassword(AbortSignal.timeout(10_000))) !== value) throw new Error('Readback failed')
      return reference
    } catch {
      this.state = 'unavailable'
      await entry?.deletePassword(AbortSignal.timeout(10_000)).catch(() => {})
      throw safeError()
    }
  }

  /** Replaces the value behind an existing reference in place, for rotating OAuth tokens. The reference stays valid. */
  async update(scope: HostCredentialScope, reference: string, value: string): Promise<void> {
    if (!value || Buffer.byteLength(value) > 64 * 1024) throw new Error('Enter a credential of at most 64 KB')
    let entry: CredentialEntry | undefined
    try {
      entry = await this.entry(scope, reference)
      await entry.setPassword(value, AbortSignal.timeout(10_000))
      if ((await entry.getPassword(AbortSignal.timeout(10_000))) !== value) throw new Error('Readback failed')
      this.state = 'available'
    } catch {
      this.state = 'unavailable'
      throw safeError()
    }
  }

  async read(scope: HostCredentialScope, reference: string): Promise<string> {
    try {
      const entry = await this.entry(scope, reference)
      const value = await entry.getPassword(AbortSignal.timeout(10_000))
      if (value === null) throw new Error('Credential is absent')
      this.state = 'available'
      return value
    } catch {
      this.state = 'unavailable'
      throw safeError()
    }
  }

  async remove(scope: HostCredentialScope, reference: string): Promise<void> {
    try {
      const entry = await this.entry(scope, reference)
      await entry.deletePassword(AbortSignal.timeout(10_000))
    } catch {
      this.state = 'unavailable'
      throw safeError()
    }
  }
}
