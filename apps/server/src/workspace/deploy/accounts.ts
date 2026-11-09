// One sign-in per hosting platform, resource provider, store service and media service on this host, used by deploys,
// databases, store releases, Publish to the web and abilities. The token lives in the host credential store; ordinary
// state keeps only a reference and the account name Settings shows.
import {
  ACCOUNT_PLATFORMS,
  isHostingPlatform,
  isMediaService,
  type AccountPlatform,
  type HostingAccount,
} from '@ramu/shared/types/deploy'
import { HostCredentialStore } from '../../credentials/store'
import { SavedCredential } from '../forge/savedCredential'
import { DeployError, hostingAdapter, type HostingAdapter, type HostingAuth } from './adapter'
import { expoClient } from './expo'
import { resourceAdapter } from './resource'
import './vercel'
import './netlify'
import './neon'
import { mediaConnector } from '../../media/mediaServices'

/** What an account needs from its platform's adapter: a name, a token page and who a token belongs to. */
type AccountAdapter = Pick<HostingAdapter, 'name' | 'tokenPage' | 'account'> & { kind: HostingAccount['kind'] }

const expo = expoClient()

function accountAdapter(platform: AccountPlatform): AccountAdapter {
  if (platform === 'expo') return expo
  if (isMediaService(platform)) return mediaConnector(platform)
  if (!isHostingPlatform(platform)) return resourceAdapter(platform)
  const adapter = hostingAdapter(platform)
  return { name: adapter.name, tokenPage: adapter.tokenPage, account: (auth) => adapter.account(auth), kind: 'hosting' }
}

interface SavedHosting {
  token: string
  /** The account name shown in Settings. */
  label?: string
  accountId?: string
  via?: 'cli' | 'token'
  defaultScope?: string | null
  broadScope?: string | null
  /** A CLI sign-in (Vercel) is an OAuth session: its access token expires and is renewed with this. */
  refreshToken?: string
  /** Milliseconds. */
  expiresAt?: number
}

/** What a CLI sign-in or a pasted token hands over before it is checked. */
export interface HostingSecret {
  token: string
  refreshToken?: string
  expiresAt?: number
}

/** Where a platform's CLI session is renewed, and the CLI's OAuth client it was issued to. */
export type OAuthRenewal = Partial<Record<AccountPlatform, { url: string; client: string }>>

const CLI_OAUTH: OAuthRenewal = {
  vercel: { url: 'https://api.vercel.com/login/oauth/token', client: 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp' },
}
const RENEW_BEFORE_MS = 5 * 60_000

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

export class HostingAccounts {
  private readonly saved: Record<AccountPlatform, SavedCredential<SavedHosting>>
  private readonly identitySaved = new Map<string, SavedCredential<SavedHosting>>()
  private readonly forIdentity: (platform: AccountPlatform, identity: string) => SavedCredential<SavedHosting>
  private readonly identityIndex: () => Record<string, string[]>
  private readonly setIdentityIndex: (value: Record<string, string[]>) => void
  /**
   * The identity a project acts as, so a deploy, database or release uses that identity's own account of the platform
   * when it has one, and the account for every identity otherwise.
   */
  identityOf: (projectId: string | null | undefined) => string | null = () => null

  /** Whether this project's identity has its own account of the platform. */
  ownFor(platform: AccountPlatform, projectId: string | null): boolean {
    return this.resolve(platform, projectId).identity !== null
  }

  /** The saved account a call for this project uses, and the identity it belongs to (null for the shared one). */
  private resolve(
    platform: AccountPlatform,
    projectId?: string | null,
  ): { saved: SavedCredential<SavedHosting>; identity: string | null } {
    const identity = this.identityOf(projectId)
    if (identity && this.identityIndex()[platform]?.includes(identity))
      return { saved: this.forIdentity(platform, identity), identity }
    return { saved: this.saved[platform], identity: null }
  }
  private readonly errors = new Map<AccountPlatform, string>()
  // Refresh tokens rotate, so calls that all find a session about to expire share one renewal instead of racing.
  private readonly renewing = new Map<string, Promise<SavedHosting>>()
  constructor(
    getState: State,
    setState: SetState,
    credentials = new HostCredentialStore(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly oauth: OAuthRenewal = CLI_OAUTH,
    private readonly adapter: (platform: AccountPlatform) => AccountAdapter = accountAdapter,
  ) {
    const saved = (platform: AccountPlatform) =>
      new SavedCredential<SavedHosting>(
        { key: `hosting-${platform}`, connectionId: `hosting-${platform}`, shown: 'label' },
        getState,
        setState,
        credentials,
      )
    // A platform's further accounts, each kept for one identity, such as a client's Vercel team beside your own.
    this.forIdentity = (platform, identity) => {
      const key = `${platform}@${identity}`
      let found = this.identitySaved.get(key)
      if (!found) {
        found = new SavedCredential<SavedHosting>(
          { key: `hosting-${key}`, connectionId: `hosting-${key}`, shown: 'label' },
          getState,
          setState,
          credentials,
        )
        this.identitySaved.set(key, found)
      }
      return found
    }
    this.identityIndex = () =>
      (getState('hosting-identities', null) as unknown as Record<string, string[]> | null) ?? {}
    this.setIdentityIndex = (value) => setState('hosting-identities', value as never)
    this.saved = {
      vercel: saved('vercel'),
      netlify: saved('netlify'),
      neon: saved('neon'),
      expo: saved('expo'),
      gemini: saved('gemini'),
      elevenlabs: saved('elevenlabs'),
    }
  }

  /** Every platform's connection; `check` asks each connected platform who the token is. */
  async list(check: boolean, cli: (platform: AccountPlatform) => boolean): Promise<HostingAccount[]> {
    const shared = await Promise.all(
      ACCOUNT_PLATFORMS.map(async (platform) => {
        if (check && this.saved[platform].savedField()) await this.check(platform)
        return this.describe(platform, cli(platform))
      }),
    )
    const index = this.identityIndex()
    const own = await Promise.all(
      ACCOUNT_PLATFORMS.flatMap((platform) =>
        (index[platform] ?? []).map((identity) => this.describe(platform, cli(platform), identity)),
      ),
    )
    return [...shared, ...own]
  }

  /** The account name Settings shows for a saved sign-in, without reading the token. */
  accountName(platform: AccountPlatform): string | null {
    return this.saved[platform].savedField()?.shown ?? null
  }

  /** Whether a token is saved, without reading it. */
  connected(platform: AccountPlatform, projectId?: string | null): boolean {
    return !!this.resolve(platform, projectId).saved.savedField()
  }

  private async describe(platform: AccountPlatform, cli: boolean, identity?: string): Promise<HostingAccount> {
    const adapter = this.adapter(platform)
    const store = identity ? this.forIdentity(platform, identity) : this.saved[platform]
    const shown = store.savedField()
    const value = shown ? await store.read().catch(() => null) : null
    return {
      ...(identity ? { identityId: identity } : {}),
      platform,
      kind: adapter.kind,
      name: adapter.name,
      connected: !!shown,
      account: shown?.shown ?? null,
      via: value?.via ?? (shown ? 'token' : null),
      expiresAt: value?.via === 'cli' ? null : (value?.expiresAt ?? null),
      broadScope: value?.broadScope ?? null,
      error: shown ? (this.errors.get(platform) ?? null) : null,
      cli,
      tokenPage: adapter.tokenPage,
    }
  }

  private async check(platform: AccountPlatform): Promise<void> {
    try {
      const { auth } = await this.auth(platform)
      await this.adapter(platform).account(auth)
      this.errors.delete(platform)
    } catch (error) {
      this.errors.set(platform, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Checks a secret against the platform's account endpoint, then keeps it. A refused one never replaces a working
   * connection.
   */
  async save(
    platform: AccountPlatform,
    secret: HostingSecret,
    via: 'cli' | 'token',
    /** Keep it as one identity's own account of the platform, beside the one for every identity. */
    forIdentity?: string,
  ): Promise<HostingAccount> {
    const identity = await this.adapter(platform).account({ token: secret.token })
    if (forIdentity) {
      const index = this.identityIndex()
      if (!index[platform]?.includes(forIdentity))
        this.setIdentityIndex({ ...index, [platform]: [...(index[platform] ?? []), forIdentity] })
    }
    await (forIdentity ? this.forIdentity(platform, forIdentity) : this.saved[platform]).save({
      token: secret.token,
      label: identity.name,
      accountId: identity.id,
      via,
      defaultScope: identity.defaultScope,
      broadScope: identity.broadScope,
      ...(secret.refreshToken ? { refreshToken: secret.refreshToken } : {}),
      ...((secret.expiresAt ?? identity.expiresAt) ? { expiresAt: secret.expiresAt ?? identity.expiresAt! } : {}),
    })
    this.errors.delete(platform)
    return this.describe(platform, via === 'cli', forIdentity)
  }

  async disconnect(platform: AccountPlatform, identity?: string): Promise<void> {
    this.errors.delete(platform)
    if (!identity) return this.saved[platform].remove()
    await this.forIdentity(platform, identity).remove()
    const index = this.identityIndex()
    this.setIdentityIndex({ ...index, [platform]: (index[platform] ?? []).filter((entry) => entry !== identity) })
  }

  /** The token a call runs with, renewed first when it is a session about to expire. */
  async auth(
    platform: AccountPlatform,
    /** The project the call acts for, so its identity's own account is used when it has one. */
    projectId?: string | null,
  ): Promise<{ auth: HostingAuth; accountId: string | null; defaultScope: string | null; identity?: string | null }> {
    const { saved, identity } = this.resolve(platform, projectId)
    let value = await saved.read()
    if (!value)
      throw new DeployError(
        `Connect ${this.adapter(platform).name} in ${isMediaService(platform) ? 'Settings → Providers' : 'Settings → Deploy'} first.`,
        'signed-out',
      )
    if (value.refreshToken && value.expiresAt && value.expiresAt - RENEW_BEFORE_MS < Date.now())
      value = await this.renewOnce(platform, value, saved)
    return {
      auth: { token: value.token },
      accountId: value.accountId ?? null,
      defaultScope: value.defaultScope ?? null,
      identity,
    }
  }

  private renewOnce(
    platform: AccountPlatform,
    value: SavedHosting,
    saved: SavedCredential<SavedHosting>,
  ): Promise<SavedHosting> {
    const key = saved === this.saved[platform] ? platform : `${platform}@${value.accountId ?? ''}`
    const pending = this.renewing.get(key)
    if (pending) return pending
    const renewal = this.renew(platform, value, saved).finally(() => this.renewing.delete(key))
    this.renewing.set(key, renewal)
    return renewal
  }

  private async renew(
    platform: AccountPlatform,
    value: SavedHosting,
    saved: SavedCredential<SavedHosting>,
  ): Promise<SavedHosting> {
    const name = this.adapter(platform).name
    const oauth = this.oauth[platform]
    if (!oauth)
      throw new DeployError(`The ${name} sign-in ended. Connect ${name} again in Settings → Deploy.`, 'signed-out')
    let response: Response
    try {
      response = await this.fetcher(oauth.url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: oauth.client,
          grant_type: 'refresh_token',
          refresh_token: value.refreshToken!,
        }).toString(),
      })
    } catch (error) {
      throw new DeployError(`${name} did not answer while renewing the sign-in.`, null, null, { cause: error })
    }
    if (!response.ok)
      throw new DeployError(
        `The ${name} sign-in ended. Connect ${name} again in Settings → Deploy.`,
        'signed-out',
        response.status,
      )
    const renewed = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!renewed.access_token) throw new DeployError(`${name} sent no new sign-in.`, 'signed-out')
    const next: SavedHosting = {
      ...value,
      token: renewed.access_token,
      // Refresh tokens rotate: the old one stops working once a new one is issued.
      refreshToken: renewed.refresh_token ?? value.refreshToken,
      expiresAt: Date.now() + (renewed.expires_in ?? 3600) * 1000,
    }
    await saved.save(next)
    return next
  }
}
