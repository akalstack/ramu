// This desktop's Ramu Link account: the session that lets it find the hosts linked to the same account and reach them
// through the relay. The session token is sealed like host tokens; the renderer only sees the name and email.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { useLinkTransport } from '@ramu/client-runtime'
import {
  LinkApiError,
  linkHosts,
  linkMe,
  signOutLink,
  startSignIn,
  waitForSignIn,
  type SignInStart,
} from '@ramu/shared/link/account'
import { DEFAULT_LINK_SERVICE, linkServiceUrl } from '@ramu/shared/link/protocol'
import type { LinkAccountStatus, LinkAccountHost } from '@ramu/shared/types'
import type { Sealer } from './remoteServers'

interface Saved {
  service: string | null
  account: { name: string; email: string } | null
  token: string | null
  sealed: boolean
}

export interface LinkAccountDeps {
  path: string
  sealer: Sealer
  /** The pinned key of a paired host, by its durable id. */
  pinned(hostId: string): string | null
  /** The Link service this computer's own host uses, offered so the person does not type it twice. */
  localService(): Promise<string | null>
  /** This computer's own host id, left out of the list of hosts to connect. */
  localHostId(): Promise<string | null>
  /** The saved host with this durable id, if this desktop already paired it. */
  pairedId(hostId: string): string | null
  changed(): void
}

export class LinkAccount {
  private saved: Saved
  private pending: { start: SignInStart; abort: AbortController } | null = null
  private error: string | null = null

  constructor(private readonly deps: LinkAccountDeps) {
    this.saved = this.read()
    useLinkTransport({
      account: () => {
        const service = this.service()
        const token = this.token()
        return service && token ? { service, token } : null
      },
      pinned: (hostId) => deps.pinned(hostId),
      random: (bytes) => new Uint8Array(randomBytes(bytes)),
    })
  }

  private read(): Saved {
    try {
      const value = JSON.parse(readFileSync(this.deps.path, 'utf8')) as Partial<Saved>
      return {
        service: typeof value.service === 'string' ? value.service : null,
        account:
          value.account && typeof value.account.email === 'string' && typeof value.account.name === 'string'
            ? value.account
            : null,
        token: typeof value.token === 'string' ? value.token : null,
        sealed: value.sealed === true,
      }
    } catch {
      return { service: null, account: null, token: null, sealed: false }
    }
  }
  private write() {
    mkdirSync(dirname(this.deps.path), { recursive: true, mode: 0o700 })
    writeFileSync(this.deps.path, JSON.stringify(this.saved, null, 2), { mode: 0o600 })
  }
  private token(): string | null {
    if (!this.saved.token) return null
    try {
      return this.saved.sealed ? this.deps.sealer.open(this.saved.token) : this.saved.token
    } catch {
      return null
    }
  }
  private service(): string | null {
    return this.saved.service ?? DEFAULT_LINK_SERVICE
  }

  async status(): Promise<LinkAccountStatus> {
    return {
      service: this.service() ?? (await this.deps.localService().catch(() => null)),
      account: this.saved.account,
      signIn: this.pending
        ? {
            userCode: this.pending.start.userCode,
            url: this.pending.start.url,
            expiresAt: this.pending.start.expiresAt,
          }
        : null,
      error: this.error,
    }
  }

  setService(input: string | null) {
    if (this.saved.account) throw new Error('Sign out of Ramu Link before changing the service')
    this.saved.service = input === null || input.trim() === '' ? null : linkServiceUrl(input)
    this.write()
    this.deps.changed()
  }

  async signIn(): Promise<LinkAccountStatus> {
    const service = this.service() ?? (await this.deps.localService().catch(() => null))
    if (!service) throw new Error('Choose a Ramu Link service first')
    this.pending?.abort.abort()
    const start = await startSignIn(fetch, service, 'ramu-desktop')
    const abort = new AbortController()
    this.pending = { start, abort }
    this.error = null
    this.deps.changed()
    void waitForSignIn(fetch, service, 'ramu-desktop', start, abort.signal)
      .then(async (token) => {
        const me = await linkMe(fetch, service, token)
        const sealed = this.deps.sealer.available
        this.saved = {
          service,
          account: me.user,
          token: sealed ? this.deps.sealer.seal(token) : token,
          sealed,
        }
        this.write()
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) this.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        if (this.pending?.abort === abort) this.pending = null
        this.deps.changed()
      })
    return this.status()
  }

  cancelSignIn() {
    this.pending?.abort.abort()
    this.pending = null
    this.deps.changed()
  }

  async signOut() {
    const service = this.service()
    const token = this.token()
    if (service && token) await signOutLink(fetch, service, token)
    this.saved = { ...this.saved, account: null, token: null, sealed: false }
    this.write()
    this.deps.changed()
  }

  /** The account's hosts, without this computer's own, each marked when this desktop already paired it. */
  async hosts(): Promise<LinkAccountHost[]> {
    const service = this.service()
    const token = this.token()
    if (!service || !token) return []
    try {
      const [{ hosts }, self] = await Promise.all([linkHosts(fetch, service, token), this.deps.localHostId()])
      return hosts
        .filter((host) => host.hostId !== self)
        .map((host) => {
          const paired = this.deps.pairedId(host.hostId)
          return { ...host, ...(paired ? { pairedId: paired } : {}) }
        })
    } catch (error) {
      if (error instanceof LinkApiError && error.status === 401) {
        this.error = error.message
        this.saved = { ...this.saved, account: null, token: null, sealed: false }
        this.write()
        this.deps.changed()
        return []
      }
      throw error
    }
  }

  stop() {
    this.pending?.abort.abort()
  }
}
