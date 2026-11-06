// One sign-in per hosting platform on this host, used by deploys and by Publish to the web. The token lives in the
// host credential store; ordinary state keeps only a reference and the account name Settings shows.
import { HOSTING_PLATFORMS, type HostingAccount, type HostingPlatform } from '@ramu/shared/types/deploy'
import { HostCredentialStore } from '../../credentials/store'
import { SavedCredential } from '../forge/savedCredential'
import { DeployError, hostingAdapter, type HostingAdapter, type HostingAuth } from './adapter'
import './vercel'
import './netlify'

interface SavedHosting {
  token: string
  /** The account name shown in Settings. */
  label?: string
  accountId?: string
  via?: 'cli' | 'token'
  defaultScope?: string | null
  broadScope?: string | null
  /** A Vercel CLI sign-in is an OAuth session: its access token expires and is renewed with this. */
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

/** Vercel's OAuth client for its CLI: a CLI session is renewed with the client it was issued to. */
const VERCEL_CLI_CLIENT = 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp'
const RENEW_BEFORE_MS = 5 * 60_000

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

export class HostingAccounts {
  private readonly saved: Record<HostingPlatform, SavedCredential<SavedHosting>>
  private readonly errors = new Map<HostingPlatform, string>()

  constructor(
    getState: State,
    setState: SetState,
    credentials = new HostCredentialStore(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly vercelOAuth = 'https://api.vercel.com/login/oauth/token',
    private readonly adapter: (platform: HostingPlatform) => HostingAdapter = hostingAdapter,
  ) {
    const saved = (platform: HostingPlatform) =>
      new SavedCredential<SavedHosting>(
        { key: `hosting-${platform}`, connectionId: `hosting-${platform}`, shown: 'label' },
        getState,
        setState,
        credentials,
      )
    this.saved = { vercel: saved('vercel'), netlify: saved('netlify') }
  }

  /** Every platform's connection; `check` asks each connected platform who the token is. */
  async list(check: boolean, cli: (platform: HostingPlatform) => boolean): Promise<HostingAccount[]> {
    return Promise.all(
      HOSTING_PLATFORMS.map(async (platform) => {
        if (check && this.saved[platform].savedField()) await this.check(platform)
        return this.describe(platform, cli(platform))
      }),
    )
  }

  /** Whether a token is saved, without reading it. */
  connected(platform: HostingPlatform): boolean {
    return !!this.saved[platform].savedField()
  }

  private async describe(platform: HostingPlatform, cli: boolean): Promise<HostingAccount> {
    const adapter = this.adapter(platform)
    const shown = this.saved[platform].savedField()
    const value = shown ? await this.saved[platform].read().catch(() => null) : null
    return {
      platform,
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

  private async check(platform: HostingPlatform): Promise<void> {
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
  async save(platform: HostingPlatform, secret: HostingSecret, via: 'cli' | 'token'): Promise<HostingAccount> {
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

  async disconnect(platform: HostingPlatform): Promise<void> {
    this.errors.delete(platform)
    await this.saved[platform].remove()
  }

  /** The token a call uses, renewed first when it is a session about to expire. */
  async auth(
    platform: HostingPlatform,
  ): Promise<{ auth: HostingAuth; accountId: string | null; defaultScope: string | null }> {
    let value = await this.saved[platform].read()
    if (!value)
      throw new DeployError(
        `Connect ${this.adapter(platform).name} in Settings → Hosting accounts first.`,
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

  private async renew(platform: HostingPlatform, value: SavedHosting): Promise<SavedHosting> {
    let response: Response
    try {
      response = await this.fetcher(this.vercelOAuth, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: VERCEL_CLI_CLIENT,
          grant_type: 'refresh_token',
          refresh_token: value.refreshToken!,
        }).toString(),
      })
    } catch (error) {
      throw new DeployError('Vercel did not answer while renewing the sign-in.', null, null, { cause: error })
    }
    if (!response.ok)
      throw new DeployError(
        'The Vercel sign-in ended. Connect Vercel again in Settings → Hosting accounts.',
        'signed-out',
        response.status,
      )
    const renewed = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!renewed.access_token) throw new DeployError('Vercel sent no new sign-in.', 'signed-out')
    const next: SavedHosting = {
      ...value,
      token: renewed.access_token,
      // Refresh tokens rotate: the old one stops working once this one is issued.
      refreshToken: renewed.refresh_token ?? value.refreshToken,
      expiresAt: Date.now() + (renewed.expires_in ?? 3600) * 1000,
    }
    await this.saved[platform].save(next)
    return next
  }
}
