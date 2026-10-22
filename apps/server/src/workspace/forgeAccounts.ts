// GitHub credentials saved on this host. Tokens live only in the host credential store (credentials/store.ts); the
// ordinary app state keeps opaque references and non-secret metadata. Nothing here reads or changes the Git
// configuration, remote URLs, credential helpers or SSH keys, and nothing logs out an external CLI.
import { randomUUID } from 'node:crypto'
import type {
  ForgeConnectionState,
  ForgeConnectionSummary,
  ForgeSaveConnectionInput,
  ForgeSavedConnection,
} from '@ramu/shared/types'
import { githubApiBase, normalizeOrigin, redactSecrets } from '@ramu/shared/forgeRemote'
import { HostCredentialStore, type HostCredentialScope } from '../credentials/store'

interface StoredConnection {
  id: string
  origin: string
  /** Non-secret account name used to scope the credential entry. */
  accountId: string
  login: string | null
  reference: string
  enabled: boolean
  state: ForgeConnectionState
  verifiedAt: number | null
  scopes: string[]
  detail: string | null
}

interface ForgeIndex {
  hostId: string
  connections: StoredConnection[]
  /** Per origin: a saved connection id, `cli` or `cli:<login>`. */
  selected: Record<string, string>
  /** Per `origin/owner/repo`: a connection id or `cli:<login>` that wins over the origin's selection. */
  overrides: Record<string, string>
}

export const FORGE_STATE_KEY = 'forge-connections'
const MAX_CONNECTIONS = 20

export interface TokenCheck {
  state: ForgeConnectionState
  login: string | null
  scopes: string[]
  detail: string | null
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Asks the origin who the token belongs to. The token goes only to that origin's API: a redirect is refused rather
 * than followed, so a credential can never travel to another host. A passing check proves identity, not access to
 * any repository.
 */
export async function checkGithubToken(origin: string, token: string, fetchImpl: Fetch = fetch): Promise<TokenCheck> {
  const failed = (state: ForgeConnectionState, detail: string): TokenCheck => ({
    state,
    login: null,
    scopes: [],
    detail,
  })
  let response: Response
  try {
    response = await fetchImpl(`${githubApiBase(origin)}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Ramu',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/redirect/i.test(message))
      return failed('unsupported-server', 'The server redirected the request, so the credential was not sent on.')
    return failed('offline', 'Could not reach the server from this host.')
  }
  if (response.status === 401) return failed('expired', 'The server rejected this token. It may be expired or revoked.')
  if (response.status === 403 || response.status === 429) {
    const limited = response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')
    return limited || response.status === 429
      ? failed('rate-limited', 'The server is rate limiting this account. Try again later.')
      : failed('missing-permission', 'The token is valid but not allowed to read the account.')
  }
  if (response.status === 404 || response.status >= 500)
    return failed('unsupported-server', 'This server did not answer like a GitHub API.')
  if (!response.ok) return failed('unsupported-server', `The server answered with status ${response.status}.`)
  let body: { login?: unknown }
  try {
    body = (await response.json()) as { login?: unknown }
  } catch {
    return failed('unsupported-server', 'This server did not answer like a GitHub API.')
  }
  if (typeof body.login !== 'string' || !body.login)
    return failed('unsupported-server', 'This server did not answer like a GitHub API.')
  const header = response.headers.get('x-oauth-scopes')
  // Classic tokens list their scopes; fine-grained tokens send none and are judged per repository.
  const scopes = header
    ? header
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
    : []
  if (header !== null && !scopes.some((scope) => scope === 'repo' || scope === 'public_repo'))
    return {
      state: 'missing-permission',
      login: body.login,
      scopes,
      detail:
        'The token cannot access repositories. Add the repo scope, or use a fine-grained token with repository access.',
    }
  return { state: 'connected', login: body.login, scopes, detail: null }
}

export type ForgeAccountResolution =
  | { kind: 'saved'; connectionId: string; login: string | null; token: string }
  | { kind: 'cli'; login: string | null }
  | { kind: 'ambiguous'; candidates: { id: string; login: string | null }[] }

export class ForgeAccountError extends Error {}

/**
 * Saved GitHub connections. Replacement and removal are atomic with respect to the index: the new credential is
 * written and verified before it is published, and a failed check keeps the connection that worked.
 */
export class ForgeAccountStore {
  /** Bumped by every change that can alter which account or token a call would use. */
  revision = 0

  constructor(
    private readonly getState: (key: string, fallback: ForgeIndex | null) => ForgeIndex | null,
    private readonly setState: (key: string, value: ForgeIndex) => void,
    private readonly credentials = new HostCredentialStore(),
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly changed: (event: { removedId?: string; disabledId?: string }) => void = () => {},
  ) {}

  private index(): ForgeIndex {
    const index = this.getState(FORGE_STATE_KEY, null)
    if (index?.hostId) return index
    const created: ForgeIndex = { hostId: randomUUID(), connections: [], selected: {}, overrides: {} }
    this.setState(FORGE_STATE_KEY, created)
    return created
  }

  private publish(index: ForgeIndex, event: { removedId?: string; disabledId?: string } = {}) {
    this.setState(FORGE_STATE_KEY, index)
    this.revision++
    this.changed(event)
  }

  private scope(index: ForgeIndex, connection: Pick<StoredConnection, 'id' | 'accountId'>): HostCredentialScope {
    return { hostId: index.hostId, integration: 'forge', connectionId: connection.id, accountId: connection.accountId }
  }

  summary(
    canAdminister: boolean,
  ): Pick<ForgeConnectionSummary, 'saved' | 'credentialStore' | 'canAdminister' | 'selection'> {
    const index = this.index()
    const saved: ForgeSavedConnection[] = index.connections.map((connection) => ({
      id: connection.id,
      origin: connection.origin,
      login: connection.login,
      enabled: connection.enabled,
      selected: index.selected[connection.origin] === connection.id,
      state: connection.state,
      verifiedAt: connection.verifiedAt,
      scopes: connection.scopes,
      detail: connection.detail,
    }))
    return {
      saved,
      credentialStore: this.credentials.status(),
      canAdminister,
      selection: { ...index.selected },
    }
  }

  /** Saves a token for one origin, or replaces an existing connection's token, after the origin vouches for it. */
  async save(input: ForgeSaveConnectionInput): Promise<ForgeSavedConnection> {
    const origin = normalizeOrigin(input.origin)
    if (!origin) throw new ForgeAccountError('Enter the server as a host name, such as github.com or ghe.example.com.')
    const token = input.token.trim()
    if (!token || /\s/.test(token)) throw new ForgeAccountError('Paste the token on its own, without spaces.')
    const index = this.index()
    const previous = input.replaceId
      ? index.connections.find((connection) => connection.id === input.replaceId)
      : undefined
    if (input.replaceId && !previous) throw new ForgeAccountError('That connection no longer exists.')
    if (previous && previous.origin !== origin)
      throw new ForgeAccountError('A credential is bound to its server. Connect the other server separately.')
    if (!previous && index.connections.length >= MAX_CONNECTIONS)
      throw new ForgeAccountError(`Remove a connection first: at most ${MAX_CONNECTIONS} can be saved.`)
    const check = await checkGithubToken(origin, token, this.fetchImpl)
    // Only a token that works may become a connection; anything else leaves the existing one untouched.
    if (check.state !== 'connected' || !check.login)
      throw new ForgeAccountError(check.detail ?? 'The server did not accept this token.')
    const existing = previous ?? index.connections.find((c) => c.origin === origin && c.login === check.login)
    const id = existing?.id ?? randomUUID()
    const accountId = check.login
    const reference = await this.credentials.put(
      { hostId: index.hostId, integration: 'forge', connectionId: id, accountId },
      token,
    )
    // Re-read: the credential write awaited, and other changes may have landed meanwhile.
    const next = this.index()
    const stored: StoredConnection = {
      id,
      origin,
      accountId,
      login: check.login,
      reference,
      enabled: existing?.enabled ?? true,
      state: 'connected',
      verifiedAt: this.now(),
      scopes: check.scopes,
      detail: null,
    }
    const connections = existing
      ? next.connections.map((c) => (c.id === id ? stored : c))
      : [...next.connections, stored]
    const selected = { ...next.selected }
    if (!selected[origin]) selected[origin] = id
    this.publish({ ...next, connections, selected })
    // The new entry is published; a failed cleanup only leaves an unreferenced credential behind.
    if (existing) await this.credentials.remove(this.scope(next, existing), existing.reference).catch(() => {})
    return this.summary(true).saved!.find((c) => c.id === id)!
  }

  /** Verifies a saved token again. A failure records why but never deletes the credential. */
  async check(id: string): Promise<ForgeSavedConnection> {
    const index = this.index()
    const connection = index.connections.find((c) => c.id === id)
    if (!connection) throw new ForgeAccountError('That connection no longer exists.')
    const token = await this.credentials.read(this.scope(index, connection), connection.reference)
    const check = await checkGithubToken(connection.origin, token, this.fetchImpl)
    const next = this.index()
    this.publish({
      ...next,
      connections: next.connections.map((c) =>
        c.id === id
          ? {
              ...c,
              login: check.login ?? c.login,
              state: check.state,
              scopes: check.state === 'connected' || check.login ? check.scopes : c.scopes,
              verifiedAt: this.now(),
              detail: check.detail,
            }
          : c,
      ),
    })
    return this.summary(true).saved!.find((c) => c.id === id)!
  }

  setEnabled(id: string, enabled: boolean): void {
    const index = this.index()
    if (!index.connections.some((c) => c.id === id)) throw new ForgeAccountError('That connection no longer exists.')
    this.publish(
      { ...index, connections: index.connections.map((c) => (c.id === id ? { ...c, enabled } : c)) },
      enabled ? {} : { disabledId: id },
    )
  }

  /** Chooses the account an origin uses: a saved connection id, `cli` or `cli:<login>`. */
  select(origin: string, account: string): void {
    const normalized = normalizeOrigin(origin)
    if (!normalized) throw new ForgeAccountError('Unknown server.')
    const index = this.index()
    this.assertAccount(index, normalized, account)
    this.publish({ ...index, selected: { ...index.selected, [normalized]: account } })
  }

  /** Pins one repository (`origin`, owner, name) to an account, or clears the pin with null. */
  setRepositoryAccount(origin: string, owner: string, repo: string, account: string | null): void {
    const normalized = normalizeOrigin(origin)
    if (!normalized) throw new ForgeAccountError('Unknown server.')
    const index = this.index()
    const key = `${normalized}/${owner}/${repo}`.toLowerCase()
    const overrides = { ...index.overrides }
    if (account === null) delete overrides[key]
    else {
      this.assertAccount(index, normalized, account)
      overrides[key] = account
    }
    this.publish({ ...index, overrides })
  }

  private assertAccount(index: ForgeIndex, origin: string, account: string) {
    if (account === 'cli' || /^cli:[A-Za-z0-9-]{1,39}$/.test(account)) return
    if (!index.connections.some((c) => c.id === account && c.origin === origin))
      throw new ForgeAccountError('That account is not saved for this server.')
  }

  /** Removes only Ramu's own credential and references; an external CLI sign-in is untouched. */
  async remove(id: string): Promise<void> {
    const index = this.index()
    const connection = index.connections.find((c) => c.id === id)
    if (!connection) return
    const selected = Object.fromEntries(Object.entries(index.selected).filter(([, value]) => value !== id))
    const overrides = Object.fromEntries(Object.entries(index.overrides).filter(([, value]) => value !== id))
    // The reference is dropped first so a locked store never leaves a connection that looks usable.
    this.publish(
      { ...index, connections: index.connections.filter((c) => c.id !== id), selected, overrides },
      { removedId: id },
    )
    await this.credentials.remove(this.scope(index, connection), connection.reference).catch(() => {
      throw new ForgeAccountError(
        'The connection was removed, but the saved token could not be deleted because the credential store is locked. Unlock it and remove the token from the provider if needed.',
      )
    })
  }

  /**
   * The account for a repository: its pin, else the origin's choice. With no choice, one saved connection is the
   * choice already made by saving it, several need one, and none keeps the detected CLI sign-in.
   */
  async resolve(origin: string, owner?: string, repo?: string): Promise<ForgeAccountResolution> {
    const index = this.index()
    const chosen = this.choose(index, origin, owner, repo)
    if (chosen.kind === 'cli') return { kind: 'cli', login: chosen.login }
    if (chosen.kind === 'ambiguous') return chosen
    const token = await this.credentials.read(this.scope(index, chosen.connection), chosen.connection.reference)
    return { kind: 'saved', connectionId: chosen.connection.id, login: chosen.connection.login, token }
  }

  /**
   * The identity a call would use, without reading any token: a saved connection id, `cli`, `cli:<login>`, or null
   * when several accounts need a choice. Watches record it so they can end when it changes.
   */
  choiceId(origin: string, owner?: string, repo?: string): string | null {
    const chosen = this.choose(this.index(), origin, owner, repo)
    if (chosen.kind === 'ambiguous') return null
    if (chosen.kind === 'saved') return chosen.connection.id
    return chosen.login ? `cli:${chosen.login}` : 'cli'
  }

  private choose(
    index: ForgeIndex,
    origin: string,
    owner?: string,
    repo?: string,
  ):
    | { kind: 'saved'; connection: StoredConnection }
    | { kind: 'cli'; login: string | null }
    | { kind: 'ambiguous'; candidates: { id: string; login: string | null }[] } {
    const usable = index.connections.filter((c) => c.origin === origin && c.enabled)
    const pin = owner && repo ? index.overrides[`${origin}/${owner}/${repo}`.toLowerCase()] : undefined
    const wanted = [pin, index.selected[origin]].find((choice) => {
      if (!choice) return false
      if (choice === 'cli' || choice.startsWith('cli:')) return true
      return usable.some((c) => c.id === choice)
    })
    if (wanted?.startsWith('cli')) return { kind: 'cli', login: wanted === 'cli' ? null : wanted.slice(4) }
    const pick = wanted ? usable.find((c) => c.id === wanted) : usable.length === 1 ? usable[0] : undefined
    if (pick) return { kind: 'saved', connection: pick }
    if (usable.length > 1) return { kind: 'ambiguous', candidates: usable.map((c) => ({ id: c.id, login: c.login })) }
    return { kind: 'cli', login: null }
  }

  describe(error: unknown): string {
    return redactSecrets(error instanceof Error ? error.message : String(error))
  }
}
