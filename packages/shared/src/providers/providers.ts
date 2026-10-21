import type { AgentProvider } from '../types'
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
}
export type ProviderConfiguration = Partial<
  Record<
    AgentProvider,
    {
      binary: string
      harness?: string
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
  /** Runtime compatibility for this host, apart from install, sign-in and update state. Absent on older hosts. */
  compatibility?: CompatibilityResult
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
