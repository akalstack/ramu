import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { auth, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

/** The name under which a connection's OAuth record is referenced. It starts with `mcp-`, which no plain header may. */
export const OAUTH_REFERENCE_NAME = 'mcp-oauth'

/** What is kept in the host credential store for one signed-in connection. Never in settings or SQLite. */
export interface StoredOAuth {
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformationMixed
}

export interface OAuthRecordStore {
  load(): Promise<StoredOAuth>
  /** Reads, changes and writes the record as one step no other provider can interleave with. */
  modify(change: (current: StoredOAuth) => StoredOAuth): Promise<void>
}

const locks = new Map<string, Promise<void>>()

/**
 * Every gateway and management session for one connection shares one lock over its credential entry, so a rotated
 * refresh token saved by one is never overwritten by a stale copy from another.
 */
export function lockedOAuthRecord(
  key: string,
  read: () => Promise<StoredOAuth>,
  write: (value: StoredOAuth) => Promise<void>,
): OAuthRecordStore {
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = (locks.get(key) ?? Promise.resolve()).then(work)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    locks.set(key, tail)
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key)
    })
    return run
  }
  return {
    load: () => exclusive(read),
    modify: (change) => exclusive(async () => write(change(await read()))),
  }
}

/**
 * The MCP SDK's authorization provider over one connection's stored record. Without a `transaction` it can only use
 * and refresh what is stored; a request that needs a person is refused as sign-in required rather than starting a flow
 * from a background session. With one it runs the interactive authorization-code flow with PKCE and `state`.
 */
export class HostOAuthProvider implements OAuthClientProvider {
  private verifier = ''
  authorizationUrl: URL | undefined

  constructor(
    private readonly store: OAuthRecordStore,
    private readonly transaction?: { redirectUrl: string; state: string },
  ) {}

  get redirectUrl() {
    return this.transaction?.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Ramu',
      redirect_uris: this.transaction ? [this.transaction.redirectUrl] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // A desktop app cannot keep a secret: PKCE binds the code instead.
      token_endpoint_auth_method: 'none',
    }
  }

  state() {
    if (!this.transaction) throw new UnauthorizedError('Sign-in has to be started from Settings')
    return this.transaction.state
  }

  async clientInformation() {
    return (await this.store.load()).clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.store.modify((current) => ({ ...current, clientInformation }))
  }

  /** The refresh token this provider last read, so a stale copy cannot clear what another provider just refreshed. */
  private loaded: string | undefined

  async tokens() {
    const tokens = (await this.store.load()).tokens
    this.loaded = tokens?.refresh_token
    return tokens
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.store.modify((current) => ({ ...current, tokens }))
    this.loaded = tokens.refresh_token
  }

  redirectToAuthorization(url: URL) {
    if (!this.transaction) throw new UnauthorizedError('Sign-in has to be started from Settings')
    // Only an HTTPS authorization page is ever offered to the person.
    if (url.protocol !== 'https:') throw new Error('The authorization server did not offer an HTTPS sign-in page')
    this.authorizationUrl = url
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier
  }

  codeVerifier() {
    if (!this.verifier) throw new Error('Sign-in was not started')
    return this.verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'verifier') this.verifier = ''
    if (scope !== 'all' && scope !== 'client' && scope !== 'tokens') return
    const loaded = this.loaded
    await this.store.modify((current) => {
      // Another login of this connection may have refreshed since this one read its tokens: leave those alone.
      if ((scope === 'tokens' || scope === 'all') && current.tokens?.refresh_token !== loaded && loaded !== undefined)
        return current
      if (scope === 'all') return {}
      const next = { ...current }
      if (scope === 'client') delete next.clientInformation
      if (scope === 'tokens') delete next.tokens
      return next
    })
  }
}

const page = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Ramu</title><body style="font:16px system-ui;margin:3em">${message}</body>`

export interface OAuthSignInHost {
  /** The connection must still be exactly what the person started with when the code arrives. */
  stillCurrent(): boolean
  serverUrl: string
  fetch: FetchLike
  /** Persist the finished record. Called once, after a verified callback. */
  complete(record: StoredOAuth): Promise<void>
  failed(reason: string): void
  close(): void
}

const TIMEOUT_MS = 10 * 60_000

/**
 * One sign-in: a loopback listener on the host that accepts exactly one callback carrying this transaction's `state`.
 * The transaction is bound to the host, connection, revision and service account, and cannot be revived once it
 * finishes, is cancelled or times out. The listener only exists while the transaction does.
 */
export class OAuthSignIn {
  private server: Server | undefined
  private done = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly state = randomBytes(32).toString('base64url')

  constructor(private readonly host: OAuthSignInHost) {}

  /** Starts discovery and registration and returns the page the person must open, or null when stored tokens were enough. */
  async begin(): Promise<{ url: string } | null> {
    const server = createServer((req, res) => void this.callback(req.url ?? '', res))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const redirectUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
    // Registration is fresh for each sign-in because the redirect port is chosen per transaction.
    const record: StoredOAuth = {}
    this.provider = new HostOAuthProvider(
      {
        load: async () => structuredClone(record),
        modify: async (change) => void Object.assign(record, change(structuredClone(record))),
      },
      { redirectUrl, state: this.state },
    )
    this.record = record
    this.timer = setTimeout(() => this.finish('Sign-in timed out. Start it again from Settings.'), TIMEOUT_MS)
    this.timer.unref()
    try {
      const result = await auth(this.provider, { serverUrl: this.host.serverUrl, fetchFn: this.host.fetch })
      if (result === 'AUTHORIZED') {
        await this.host.complete(record)
        this.finish()
        return null
      }
      if (!this.provider.authorizationUrl) throw new Error('No sign-in page was offered')
      return { url: this.provider.authorizationUrl.toString() }
    } catch (error) {
      this.finish('The service did not offer a supported sign-in.')
      throw new Error('The service did not offer a supported sign-in. Check its address and authorization support.')
    }
  }

  private provider!: HostOAuthProvider
  private record!: StoredOAuth

  cancel() {
    this.finish('Sign-in was cancelled.')
  }

  private async callback(path: string, res: import('node:http').ServerResponse) {
    const url = new URL(path, 'http://127.0.0.1')
    const given = Buffer.from(url.searchParams.get('state') ?? '')
    const expected = Buffer.from(this.state)
    if (
      this.done ||
      url.pathname !== '/callback' ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      res.writeHead(400, { 'content-type': 'text/html' }).end(page('This sign-in link is not valid any more.'))
      return
    }
    // One callback only: a replay or a second tab finds the transaction already consumed.
    this.done = true
    const code = url.searchParams.get('code')
    if (url.searchParams.get('error') || !code || !this.host.stillCurrent()) {
      res
        .writeHead(400, { 'content-type': 'text/html' })
        .end(page('Sign-in was not completed. Return to Ramu and try again.'))
      this.host.failed(
        this.host.stillCurrent() ? 'The service declined the sign-in.' : 'The connection changed during sign-in.',
      )
      this.finish()
      return
    }
    try {
      const result = await auth(this.provider, {
        serverUrl: this.host.serverUrl,
        authorizationCode: code,
        fetchFn: this.host.fetch,
      })
      if (result !== 'AUTHORIZED' || !this.record.tokens || !this.host.stillCurrent()) throw new Error('not authorized')
      await this.host.complete(this.record)
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(page('Signed in. You can close this tab and return to Ramu.'))
    } catch {
      res
        .writeHead(400, { 'content-type': 'text/html' })
        .end(page('Sign-in could not be finished. Return to Ramu and try again.'))
      this.host.failed('Sign-in could not be finished.')
    }
    this.finish()
  }

  private finish(reason?: string) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const wasOpen = !this.done
    this.done = true
    const server = this.server
    this.server = undefined
    if (server) setTimeout(() => server.close(), 1000).unref()
    if (reason && wasOpen) this.host.failed(reason)
    this.host.close()
  }
}
