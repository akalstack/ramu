import type { AgentProvider } from './types'

export const AGENT_PROVIDERS = ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const
export const providerName = (provider: AgentProvider): string => ({ 'claude-code': 'Claude', codex: 'Codex', opencode: 'OpenCode', cursor: 'Cursor', antigravity: 'Antigravity' })[provider]
export const isAcpProvider = (provider: AgentProvider): provider is 'cursor' | 'antigravity' | 'opencode' => provider === 'cursor' || provider === 'antigravity' || provider === 'opencode'

export interface ProviderAccount { id: string; name: string; /** Off hides the account from pickers and stops new chats from using it. Absent means on. */ enabled?: boolean }
export interface ProviderSignIn { signedIn: boolean; detail?: string }
export type ProviderConfiguration = Partial<Record<AgentProvider, { binary: string; harness?: string; accounts?: ProviderAccount[]; accountId?: string; autoUpdate?: boolean; /** Off hides the provider everywhere and stops Ramu from starting it. Absent means on. */ enabled?: boolean; /** Cursor: allow reading its login from the macOS Keychain to show plan usage. */ usageKeychain?: boolean }>>
export const providerEnabled = (config: ProviderConfiguration | undefined, provider: AgentProvider): boolean => config?.[provider]?.enabled !== false
/** Only expose isolated account profiles for CLIs with a supported credential directory. */
export const supportsProviderAccounts = (provider: AgentProvider) => provider === 'codex' || provider === 'opencode'
export interface ProviderStatus {
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
}
