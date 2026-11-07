// One sign-in per hosting platform, resource provider and store service on this host, used by deploys, databases,
// store releases and Publish to the web. The token lives in the host credential store; ordinary state keeps only a
// reference and the account name Settings shows.
import {
  ACCOUNT_PLATFORMS,
  isHostingPlatform,
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
import './railway'
import './fly'
import './server'
import './neon'

/** What an account needs from its platform's adapter: a name, a token page and who a token belongs to. */
type AccountAdapter = Pick<HostingAdapter, 'name' | 'tokenPage' | 'account'> & { kind: HostingAccount['kind'] }

const expo = expoClient()

function accountAdapter(platform: AccountPlatform): AccountAdapter {
  if (platform === 'expo') return expo
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
  /** A CLI sign-in (Vercel, Railway) is an OAuth session: its access token expires and is renewed with this. */
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
  railway: { url: 'https://backboard.railway.com/oauth/token', client: 'rlwy_oaci_onEklvmksh1hRUiCo7E2zX12' },
}
const RENEW_BEFORE_MS = 5 * 60_000

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

export class HostingAccounts {
  private readonly saved: Record<AccountPlatform, SavedCredential<SavedHosting>>
  private readonly errors = new Map<AccountPlatform, string>()

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
    this.saved = {
      vercel: saved('vercel'),
      netlify: saved('netlify'),
      railway: saved('railway'),
      fly: saved('fly'),
      server: saved('server'),
      neon: saved('neon'),
      expo: saved('expo'),
    }
  }

  /** Every platform's connection; `check` asks each connected platform who the token is. */
  async list(check: boolean, cli: (platform: AccountPlatform) => boolean): Promise<HostingAccount[]> {
    return Promise.all(
      ACCOUNT_PLATFORMS.map(async (platform) => {
        if (check && this.saved[platform].savedField()) await this.check(platform)
        return this.describe(platform, cli(platform))
      }),
    )
  }

  /** The account name Settings shows for a saved sign-in, without reading the token. */
  accountName(platform: AccountPlatform): string | null {
    return this.saved[platform].savedField()?.shown ?? null
  }

  /** Whether a token is saved, without reading it. */
  connected(platform: AccountPlatform): boolean {
    return !!this.saved[platform].savedField()
  }

  private async describe(platform: AccountPlatform, cli: boolean): Promise<HostingAccount> {
    const adapter = this.adapter(platform)
    const shown = this.saved[platform].savedField()
    const value = shown ? await this.saved[platform].read().catch(() => null) : null
    return {
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
  async save(platform: AccountPlatform, secret: HostingSecret, via: 'cli' | 'token'): Promise<HostingAccount> {
    const identity = await this.adapter(platform).account({ token: secret.token })
    await this.saved[platform].save({
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
    return this.describe(platform, via === 'cli')
  }

  async disconnect(platform: AccountPlatform): Promise<void> {
    this.errors.delete(platform)
    await this.saved[platform].remove()
  }

  /** The token a call uses, renewed first when it is a session about to expire. */
  async auth(
    platform: AccountPlatform,
  ): Promise<{ auth: HostingAuth; accountId: string | null; defaultScope: string | null }> {
    let value = await this.saved[platform].read()
    if (!value)
      throw new DeployError(
        `Connect ${this.adapter(platform).name} in Settings → Git → Hosting accounts first.`,
        'signed-out',
      )
    if (value.refreshToken && value.expiresAt && value.expiresAt - RENEW_BEFORE_MS < Date.now())
      value = await this.renew(platform, value)
    return {
      auth: { token: value.token },
      accountId: value.accountId ?? null,
      defaultScope: value.defaultScope ?? null,
    }
  }

  private async renew(platform: AccountPlatform, value: SavedHosting): Promise<SavedHosting> {
    const name = this.adapter(platform).name
    const oauth = this.oauth[platform]
    if (!oauth)
      throw new DeployError(
        `The ${name} sign-in ended. Connect ${name} again in Settings → Git → Hosting accounts.`,
        'signed-out',
      )
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
        `The ${name} sign-in ended. Connect ${name} again in Settings → Git → Hosting accounts.`,
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
    await this.saved[platform].save(next)
    return next
  }
}
