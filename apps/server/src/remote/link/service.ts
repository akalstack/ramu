// Ramu Link on the host: the account it is signed in to, its long-lived identity key, and the relay connection. Secrets
// (the session, the host's relay secret and the identity key) live only in the OS credential store; `link.json` holds
// references and what Settings shows.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Server } from 'node:http'
import {
  linkMe,
  registerLinkHost,
  signOutLink,
  startSignIn,
  unlinkHost,
  waitForSignIn,
  type SignInStart,
} from '@ramu/shared/link/account'
import { generateKeyPair, keyPairFromSecret, type KeyPair } from '@ramu/shared/link/noise'
import { DEFAULT_LINK_SERVICE, linkAddress, linkServiceUrl } from '@ramu/shared/link/protocol'
import type { LinkStatus } from '@ramu/shared/types/remote'
import { HostCredentialStore, type HostCredentialScope } from '../../credentials/store'
import { RelayClient, type RelayState } from './relayClient'

interface Saved {
  service: string | null
  enabled: boolean
  account: { name: string; email: string } | null
  refs: { session?: string; secret?: string; identity?: string }
}
const EMPTY: Saved = { service: null, enabled: false, account: null, refs: {} }

export interface LinkServiceOptions {
  statePath: string
  hostId: string
  hostName: () => string
  /** The in-memory server every Link stream is bridged into. */
  server: Server
  changed(): void
  /** `RAMU_LINK_URL`, which wins over Settings. */
  fixedService?: string | null
  credentials?: HostCredentialStore
  fetcher?: typeof fetch
}

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const hexToBytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))

export class LinkService {
  private saved: Saved
  private identity: KeyPair | null = null
  private relay: RelayClient | null = null
  private relayState: RelayState | null = null
  private error: string | null = null
  private pending: { start: SignInStart; abort: AbortController } | null = null
  private readonly credentials: HostCredentialStore
  private readonly fetcher: typeof fetch

  constructor(private readonly options: LinkServiceOptions) {
    this.credentials = options.credentials ?? new HostCredentialStore()
    this.fetcher = options.fetcher ?? fetch
    this.saved = this.read()
  }

  private read(): Saved {
    try {
      const value = JSON.parse(readFileSync(this.options.statePath, 'utf8')) as Partial<Saved>
      return {
        service: typeof value.service === 'string' ? value.service : null,
        enabled: value.enabled === true,
        account:
          value.account && typeof value.account.name === 'string' && typeof value.account.email === 'string'
            ? { name: value.account.name, email: value.account.email }
            : null,
        refs: typeof value.refs === 'object' && value.refs ? value.refs : {},
      }
    } catch {
      return { ...EMPTY, refs: {} }
    }
  }
  private write() {
    mkdirSync(dirname(this.options.statePath), { recursive: true, mode: 0o700 })
    writeFileSync(this.options.statePath, JSON.stringify(this.saved, null, 2), { mode: 0o600 })
  }
  private scope(kind: 'session' | 'secret' | 'identity'): HostCredentialScope {
    return { hostId: this.options.hostId, integration: 'link', connectionId: kind, accountId: 'link' }
  }
  private notify() {
    this.options.changed()
  }

  service(): string | null {
    return this.options.fixedService ?? this.saved.service ?? DEFAULT_LINK_SERVICE
  }

  /** Whether devices can reach this host through Link right now. */
  active(): boolean {
    return this.relayState === 'online'
  }
  address(): string {
    return linkAddress(this.options.hostId)
  }
  /** The identity key in hex, once one exists; it is created at the first sign-in. */
  hostKey(): string | null {
    return this.identity ? bytesToHex(this.identity.publicKey) : null
  }

  status(): LinkStatus {
    return {
      service: this.service(),
      serviceFixed: Boolean(this.options.fixedService),
      enabled: this.saved.enabled,
      account: this.saved.account,
      signIn: this.pending
        ? {
            userCode: this.pending.start.userCode,
            url: this.pending.start.url,
            expiresAt: this.pending.start.expiresAt,
          }
        : null,
      state: this.relay ? (this.relayState ?? 'connecting') : 'off',
      error: this.error,
      address: this.address(),
      streams: this.relay?.streamCount() ?? 0,
    }
  }

  /** Restores the identity and, when Link was on, reconnects. Never throws: a locked keychain is shown as an error. */
  async start() {
    if (!this.saved.refs.identity) return
    try {
      this.identity = keyPairFromSecret(
        hexToBytes(await this.credentials.read(this.scope('identity'), this.saved.refs.identity)),
      )
      if (this.saved.enabled) await this.connect()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.notify()
    }
  }

  setService(input: string | null) {
    if (this.options.fixedService) throw new Error('RAMU_LINK_URL sets the Ramu Link service on this host')
    if (this.saved.account) throw new Error('Sign out of Ramu Link before changing the service')
    this.saved.service = input === null || input.trim() === '' ? null : linkServiceUrl(input)
    this.write()
    this.notify()
  }

  /** Starts the device-code sign-in; the status carries the code and link until it finishes. */
  async signIn(): Promise<LinkStatus> {
    const service = this.service()
    if (!service) throw new Error('Choose a Ramu Link service first')
    this.pending?.abort.abort()
    const start = await startSignIn(this.fetcher, service, 'ramu-host')
    const abort = new AbortController()
    this.pending = { start, abort }
    this.error = null
    this.notify()
    void waitForSignIn(this.fetcher, service, 'ramu-host', start, abort.signal)
      .then((token) => this.finishSignIn(service, token))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        this.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        if (this.pending?.abort === abort) this.pending = null
        this.notify()
      })
    return this.status()
  }

  cancelSignIn() {
    this.pending?.abort.abort()
    this.pending = null
    this.notify()
  }

  private async finishSignIn(service: string, token: string) {
    const me = await linkMe(this.fetcher, service, token)
    if (!this.identity) {
      const identity = generateKeyPair(random)
      const reference = await this.credentials.put(this.scope('identity'), bytesToHex(identity.secret))
      this.identity = identity
      this.saved.refs.identity = reference
    }
    const { secret } = await registerLinkHost(this.fetcher, service, token, {
      hostId: this.options.hostId,
      name: this.options.hostName(),
      publicKey: bytesToHex(this.identity.publicKey),
    })
    await this.replace('session', token)
    await this.replace('secret', secret)
    this.saved.account = me.user
    this.saved.enabled = true
    this.write()
    await this.connect()
  }

  private async replace(kind: 'session' | 'secret', value: string) {
    const old = this.saved.refs[kind]
    this.saved.refs[kind] = await this.credentials.put(this.scope(kind), value)
    if (old) await this.credentials.remove(this.scope(kind), old).catch(() => {})
  }

  async setEnabled(enabled: boolean) {
    if (enabled && !this.saved.account) throw new Error('Sign in to Ramu Link first')
    this.saved.enabled = enabled
    this.write()
    if (enabled) await this.connect()
    else this.disconnect()
    this.notify()
  }

  /** Unlinks this host from the account (best effort when offline) and forgets every Link secret except the identity. */
  async signOut() {
    this.cancelSignIn()
    this.disconnect()
    const service = this.service()
    const session = this.saved.refs.session
      ? await this.credentials.read(this.scope('session'), this.saved.refs.session).catch(() => null)
      : null
    if (service && session) {
      await unlinkHost(this.fetcher, service, session, this.options.hostId).catch(() => {})
      await signOutLink(this.fetcher, service, session)
    }
    for (const kind of ['session', 'secret'] as const) {
      const reference = this.saved.refs[kind]
      if (reference) await this.credentials.remove(this.scope(kind), reference).catch(() => {})
      delete this.saved.refs[kind]
    }
    this.saved.account = null
    this.saved.enabled = false
    this.error = null
    this.write()
    this.notify()
  }

  private async connect() {
    const service = this.service()
    if (!service || !this.identity || !this.saved.refs.secret) return
    const secret = await this.credentials.read(this.scope('secret'), this.saved.refs.secret)
    this.disconnect()
    this.error = null
    const relay = new RelayClient({
      service,
      hostId: this.options.hostId,
      secret,
      identity: this.identity,
      server: this.options.server,
      onState: (state, error) => {
        if (this.relay !== relay) return
        this.relayState = state
        this.error = error ?? null
        this.notify()
      },
    })
    this.relay = relay
    relay.start()
  }

  private disconnect() {
    this.relay?.stop()
    this.relay = null
    this.relayState = null
  }

  stop() {
    this.pending?.abort.abort()
    this.disconnect()
  }
}
