import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { AgentProvider } from '../shared/types'
import type { ProviderConfiguration } from '../shared/providers'
import { supportsProviderAccounts } from '../shared/providers'

let configuration: ProviderConfiguration = {}
let accountsRoot = join(homedir(), '.ramu', 'provider-accounts')
let runtimesRoot = join(homedir(), '.ramu', 'provider-clis')
export function configureProviderAccounts(root: string) { accountsRoot = root; runtimesRoot = join(dirname(root), 'provider-clis') }
export function providerRuntimeHome(provider: AgentProvider) { return join(runtimesRoot, provider) }
export function providerAccountId(provider: AgentProvider) { return configuration[provider]?.accountId || 'default' }
export function providerAccountClearedEnv(provider: AgentProvider): string[] {
  return provider === 'codex' ? ['OPENAI_API_KEY', 'CODEX_API_KEY'] : provider === 'opencode' ? ['OPENCODE_DB', 'OPENCODE_AUTH_CONTENT', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'CEREBRAS_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'] : []
}
export function providerAccountHome(provider: AgentProvider, id: string): string {
  if (!supportsProviderAccounts(provider) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || id === 'default') throw new Error('Invalid provider account')
  return join(accountsRoot, provider, id)
}
export function configureProviderBinaries(value: ProviderConfiguration) { configuration = value }
const expand = (path: string) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
export function findExecutable(command: string): string | null {
  const candidates = isAbsolute(command) ? [command] : (process.env.PATH ?? '').split(delimiter).flatMap((dir) => process.platform === 'win32' ? ['', '.exe', '.cmd'].map((ext) => join(dir, command + ext)) : [join(dir, command)])
  return candidates.find((path) => { try { accessSync(path, constants.X_OK); return statSync(path).isFile() } catch { return false } }) ?? null
}
export function providerBinary(provider: AgentProvider, overrides = configuration): string {
  const custom = overrides[provider]?.binary?.trim()
  if (custom) return expand(custom)
  const env = process.env[`RAMU_${provider === 'claude-code' ? 'CLAUDE' : provider.toUpperCase()}_BIN`]
  if (env) return expand(env)
  const managed = join(providerRuntimeHome(provider), 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex')
  if (provider === 'codex' && existsSync(managed)) return managed
  const names = { 'claude-code': ['claude'], codex: ['codex'], opencode: ['opencode'], cursor: ['agent', 'cursor-agent'], antigravity: [process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par'] }[provider]
  const dirs = provider === 'opencode' ? [join(homedir(), '.opencode/bin'), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'] : [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  return dirs.flatMap((dir) => names.map((name) => join(dir, name))).find(existsSync) ?? names.map(findExecutable).find((path) => !!path) ?? names[0]!
}
export function providerEnvironment(provider: AgentProvider, overrides = configuration, accountId = overrides[provider]?.accountId || 'default'): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (accountId !== 'default') {
    if (!overrides[provider]?.accounts?.some((account) => account.id === accountId)) throw new Error('The selected provider account no longer exists')
    const root = providerAccountHome(provider, accountId)
    // Credentials remain in the CLI's own store; Ramu stores only profile names/IDs.
    if (provider === 'codex') env.CODEX_HOME = root
    if (provider === 'opencode') { env.XDG_DATA_HOME = join(root, 'data'); env.XDG_CONFIG_HOME = join(root, 'config'); env.XDG_STATE_HOME = join(root, 'state') }
    for (const key of providerAccountClearedEnv(provider)) delete env[key]
  }
  if (provider !== 'antigravity') return env
  const custom = overrides.antigravity?.harness?.trim()
  const sibling = join(dirname(providerBinary(provider, overrides)), process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external')
  const helper = custom ? expand(custom) : process.env.ANTIGRAVITY_HARNESS_PATH || (existsSync(sibling) ? sibling : undefined)
  return { ...env, ...(helper ? { ANTIGRAVITY_HARNESS_PATH: helper } : {}) }
}
