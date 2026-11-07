// One sign-in per hosting platform, resource provider and store service on this host, used by deploys, databases,
// store releases and Publish to the web. The token lives in the host credential store; ordinary state keeps only a
// reference and the account name Settings shows.
import { createHash } from 'node:crypto'
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
import './githubPages'
import './cloudflare'
import './neon'
import './supabase'
import './upstash'
import './resend'
import './workerResources'

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

/** Platforms where one host may keep several accounts at once: each linked project uses the one it was linked under. */
const KEPT: readonly AccountPlatform[] = ['server']
const keptKey = (platform: AccountPlatform) => `hosting-kept-${platform}`

export class HostingAccounts {
  private readonly saved: Record<AccountPlatform, SavedCredential<SavedHosting>>
  private readonly errors = new Map<AccountPlatform, string>()
  private readonly getState: State
  private readonly setState: SetState
  private readonly credentials: HostCredentialStore

  constructor(
    getState: State,
    setState: SetState,
    credentials = new HostCredentialStore(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly oauth: OAuthRenewal = CLI_OAUTH,
    private readonly adapter: (platform: AccountPlatform) => AccountAdapter = accountAdapter,
  ) {
    this.getState = getState
    this.setState = setState
    this.credentials = credentials
    const saved = (platform: AccountPlatform) =>
      new SavedCredential<SavedHosting>(
        { key: `hosting-${platform}`, connectionId: `hosting-${platform}`, shown: 'label' },
        getState,
        setState,
        credentials,
      )
    // Cloudflare Workers uses the Cloudflare account Pages uses: one sign-in, one place to replace it.
    const cloudflare = saved('cloudflare')
    this.saved = {
      vercel: saved('vercel'),
      netlify: saved('netlify'),
      railway: saved('railway'),
      fly: saved('fly'),
      server: saved('server'),
      'github-pages': saved('github-pages'),
      cloudflare,
      'cloudflare-workers': cloudflare,
      'cloudflare-d1': cloudflare,
      'cloudflare-kv': cloudflare,
      'cloudflare-r2': cloudflare,
      neon: saved('neon'),
      supabase: saved('supabase'),
      upstash: saved('upstash'),
      resend: saved('resend'),
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
    const current = KEPT.includes(platform) ? (await this.saved[platform].read())?.accountId : undefined
    await this.saved[platform].remove()
    if (current) {
      await this.keptCredential(platform, current).remove()
      this.setState(keptKey(platform), this.kept(platform).filter((entry) => entry.id !== current) as never)
    }
  }

  /** The token a call uses, renewed first when it is a session about to expire. */
  /** The copy of one account kept beside the current one, for a platform that keeps several. */
  private keptCredential(platform: AccountPlatform, accountId: string) {
    const id = createHash('sha256').update(accountId).digest('hex').slice(0, 16)
    return new SavedCredential<SavedHosting>(
      { key: `hosting-${platform}-${id}`, connectionId: `hosting-${platform}-${id}`, shown: 'label' },
      this.getState,
      this.setState,
      this.credentials,
    )
  }

  /** Every account kept for a platform that keeps several, by id and name; the current one is among them. */
  kept(platform: AccountPlatform): { id: string; name: string }[] {
    return (this.getState(keptKey(platform), null) as unknown as { id: string; name: string }[] | null) ?? []
  }

  /** Keeps the current account beside the others, so projects linked under it go on working after another is added. */
  async keep(platform: AccountPlatform): Promise<void> {
    if (!KEPT.includes(platform)) return
    const value = await this.saved[platform].read()
    if (!value?.accountId) return
    await this.keptCredential(platform, value.accountId).save(value)
    const others = this.kept(platform).filter((entry) => entry.id !== value.accountId)
    this.setState(keptKey(platform), [
      ...others,
      { id: value.accountId, name: value.label ?? value.accountId },
    ] as never)
  }

  /** Makes a kept account the current one, which new setups use. */
  async use(platform: AccountPlatform, accountId: string): Promise<void> {
    const value = await this.keptCredential(platform, accountId).read()
    if (!value) throw new DeployError('That account is no longer kept on this host.', 'signed-out')
    await this.saved[platform].save(value)
    this.errors.delete(platform)
  }

  /** Forgets a kept account that is not the current one. */
  async forget(platform: AccountPlatform, accountId: string): Promise<void> {
    if ((await this.saved[platform].read())?.accountId === accountId)
      throw new Error('This is the one new setups use. Use another first, or disconnect it.')
    await this.keptCredential(platform, accountId).remove()
    this.setState(keptKey(platform), this.kept(platform).filter((entry) => entry.id !== accountId) as never)
  }

  /**
   * The token a call runs with. For a platform that keeps several accounts, `accountId` picks the one a project was
   * linked under, which need not be the current one.
   */
  async auth(
    platform: AccountPlatform,
    accountId?: string | null,
  ): Promise<{ auth: HostingAuth; accountId: string | null; defaultScope: string | null }> {
    let value = await this.saved[platform].read()
    if (KEPT.includes(platform) && accountId && value?.accountId !== accountId)
      value = (await this.keptCredential(platform, accountId).read()) ?? value
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
