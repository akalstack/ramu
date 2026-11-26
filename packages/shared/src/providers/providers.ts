import type { AgentProvider, ModelStep, ProviderCatalog } from '../types'
import type { CompatibilityResult } from './compatibility'

export const AGENT_PROVIDERS = ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const
export const providerName = (provider: AgentProvider): string =>
  ({ 'claude-code': 'Claude', codex: 'Codex', opencode: 'OpenCode', cursor: 'Cursor', antigravity: 'Antigravity' })[
    provider
  ]
export const isAcpProvider = (provider: AgentProvider): provider is 'cursor' | 'antigravity' | 'opencode' =>
  provider === 'cursor' || provider === 'antigravity' || provider === 'opencode'

export interface ProviderAccount {
  id: string
  /** Optional label; without one the account is named by its sign-in email. */
  name?: string
  /** Off hides the account from pickers and stops new chats from using it. Absent means on. */ enabled?: boolean
}
export interface ProviderSignIn {
  signedIn: boolean
  detail?: string
  /** The login's email when the CLI reports it; names the account when it has no label. */
  email?: string
  /**
   * The provider's own id for the person signed in (Claude's account UUID, the ChatGPT user id), when it keeps one: the
   * same on every host, so one login is recognised across hosts even where a CLI reports no email.
   */
  accountKey?: string
  /** The plan the login is on as the provider reports it now (`pro`, `max`, `plus`, a tier name), read at every check. */
  plan?: string
  /** Where the provider offers a bigger plan, when it says. */
  upgradeUrl?: string
  /** The login uses an API key (billed per use) rather than a subscription. */
  apiKey?: boolean
}
export type ProviderConfiguration = Partial<
  Record<
    AgentProvider,
    {
      binary: string
      accounts?: ProviderAccount[]
      accountId?: string
      /** Account IDs, `default` included, in the order they are tried: the first enabled one is used first. */
      accountOrder?: string[]
      /** Off stops the default (system) login from being used. At least one login stays on. Absent means on. */
      defaultAccountEnabled?: boolean
      autoUpdate?: boolean
      /** Off hides the provider everywhere and stops Ramu from starting it. Absent means on. */ enabled?: boolean
    }
  >
>
export const providerEnabled = (config: ProviderConfiguration | undefined, provider: AgentProvider): boolean =>
  config?.[provider]?.enabled !== false
/** Only expose isolated account profiles for CLIs with a supported credential directory. */
export const supportsProviderAccounts = (_provider: AgentProvider) => true
export interface ProviderStatus {
  /** Adapter integration support; runtime MCP negotiation and desktop readiness are checked separately. */
  browser?: import('../browser').ProviderBrowserCapability
  provider: AgentProvider
  binary: string
  installed: boolean
  version: string | null
  latestVersion: string | null
  updateAvailable: boolean
  /** A newer release still inside its waiting period, and when it will be offered; `latestVersion` is what is offered. */
  waitingVersion?: string
  waitingUntil?: string
  checkedAt: string | null
  error?: string
  versionError?: string
  docsUrl: string
  installCommand: string | null
  updateCommand: string | null
  setupCommand: string | null
  setupNote: string
  downloadUrl?: string
  loginCommand?: string | null
  accountsSupported?: boolean
  updating?: boolean
  updateError?: string
  enabled: boolean
  /** Whether the CLI already has a login, per account ID ('default' is the system profile). Absent when it was not checked. */
  signIn?: Record<string, ProviderSignIn>
  /** Runtime compatibility for this host, apart from install, sign-in and update state. */
  compatibility?: CompatibilityResult
  /** The newer release's compatibility under the same policy, present only when an update is available and a rule covers it. */
  updateCompatibility?: CompatibilityResult
  /** Live ability checks for the chosen login on the installed version; only passed ones are offered. */
  abilities?: import('./abilities').AbilityCheck[]
}

/**
 * Accounts a chat may run on, in the order they are tried. The order the person arranged (`accountOrder`) decides; logins
 * missing from it follow in the order they were added, with the default login ahead of them. Without an arrangement the
 * selected account goes first. Disabled accounts are skipped, so when the active account reaches its limit a chat
 * continues on the next enabled one.
 */
export function providerAccountOrder(config: ProviderConfiguration | undefined, provider: AgentProvider): string[] {
  const entry = config?.[provider]
  const primary = entry?.accountId || 'default'
  if (!supportsProviderAccounts(provider)) return [primary]
  const enabled = (entry?.accounts ?? []).filter((account) => account.enabled !== false).map((account) => account.id)
  const arranged = entry?.accountOrder ?? []
  const all = arranged.length ? [...arranged, 'default', ...enabled] : [primary, 'default', ...enabled]
  const usable = [...new Set(all)].filter((id) =>
    id === 'default' ? defaultAccountEnabled(config, provider) : enabled.includes(id),
  )
  return usable.length ? usable : ['default']
}

export const defaultAccountEnabled = (config: ProviderConfiguration | undefined, provider: AgentProvider): boolean =>
  config?.[provider]?.defaultAccountEnabled !== false

/** Every login in the order they are tried, disabled ones included, for the arrangement list. */
export function providerAccountRows(config: ProviderConfiguration | undefined, provider: AgentProvider): string[] {
  const entry = config?.[provider]
  const known = ['default', ...(entry?.accounts ?? []).map((account) => account.id)]
  return [...new Set([...(entry?.accountOrder ?? []), ...providerAccountOrder(config, provider), ...known])].filter(
    (id) => known.includes(id),
  )
}

/** The label if one was given, else the login's email, else a position-based name. */
export function accountDisplayName(
  config: ProviderConfiguration | undefined,
  provider: AgentProvider,
  id: string,
  email?: string,
): { name: string; fallback?: 'default' | 'numbered'; number?: number } {
  if (id === 'default') return { name: email ?? '', ...(email ? {} : { fallback: 'default' as const }) }
  const accounts = config?.[provider]?.accounts ?? []
  const label = accounts.find((account) => account.id === id)?.name?.trim()
  if (label) return { name: label }
  if (email) return { name: email }
  return { name: '', fallback: 'numbered', number: accounts.findIndex((account) => account.id === id) + 2 }
}

/** What a login reports about itself for naming it: its sign-in email, and whether it runs on an API key. */
export interface AccountLogin {
  email?: string
  /** The provider's own id for the person signed in, the same on every host (see ProviderSignIn.accountKey). */
  accountKey?: string
  apiKey?: boolean
}

/**
 * A login as people read it: the label given to it, else its sign-in email, else "Default CLI account" or "Account N",
 * with "API key" added for a login that runs on one. `reveal` false leaves labels and emails out, for views that may be
 * on a shared screen. `say` is the app's translator.
 */
export function accountName(
  config: ProviderConfiguration | undefined,
  provider: AgentProvider,
  id: string,
  login: AccountLogin | undefined,
  say: (text: string, values?: Record<string, string | number>) => string,
  reveal = true,
): string {
  const shown = reveal
    ? accountDisplayName(config, provider, id, login?.email)
    : id === 'default'
      ? { name: '', fallback: 'default' as const }
      : {
          name: '',
          fallback: 'numbered' as const,
          number: (config?.[provider]?.accounts ?? []).findIndex((account) => account.id === id) + 2,
        }
  const name =
    shown.fallback === 'default'
      ? say(provider === 'antigravity' ? 'Default account' : 'Default CLI account')
      : shown.fallback === 'numbered'
        ? say('Account {0}', { '0': shown.number ?? 0 })
        : shown.name
  return login?.apiKey ? `${name} · ${say('API key')}` : name
}

/** A plan as people read it: the CLIs report `pro` or `max_20x`; tier names such as Antigravity's come titled already. */
export const planName = (plan: string) =>
  plan
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => (/^[a-z]/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')

const EFFORT_NAMES: Record<string, string> = { xhigh: 'Extra High' }

/** A model step as a picker lists it: the catalog's model name (or the provider's default) and its effort. */
export function modelStepLabel(
  step: Pick<ModelStep, 'provider' | 'model' | 'effort'>,
  catalogs: readonly ProviderCatalog[],
): string {
  const model = catalogs
    .flatMap((catalog) => catalog.models)
    .find((entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)))
  const name = model?.name ?? (step.model || `${providerName(step.provider)} default`)
  const effort = step.effort ?? model?.defaultEffort ?? null
  const effortName = effort ? (EFFORT_NAMES[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)) : ''
  return `${name} ${effortName}`.trim()
}

/**
 * Whose terms cover a provider's subscription sign-in, and where to read them. A login each for personal and work is
 * ordinary; stacking one person's own subscriptions to get around their limits is what these terms bar.
 */
export const SUBSCRIPTION_TERMS: Partial<Record<AgentProvider, { owner: string; url: string }>> = {
  'claude-code': { owner: 'Anthropic', url: 'https://www.anthropic.com/legal/consumer-terms' },
  codex: { owner: 'OpenAI', url: 'https://openai.com/policies/terms-of-use/' },
  cursor: { owner: 'Cursor', url: 'https://cursor.com/terms-of-service' },
}
