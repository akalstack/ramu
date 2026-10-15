import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { AgentProvider } from '@ramu/shared/types'
import type { ProviderConfiguration } from '@ramu/shared/providers'
import { supportsProviderAccounts } from '@ramu/shared/providers'

let configuration: ProviderConfiguration = {}
let accountsRoot = join(homedir(), '.ramu', 'provider-accounts')
let runtimesRoot = join(homedir(), '.ramu', 'provider-clis')
export function configureProviderAccounts(root: string) { accountsRoot = root; runtimesRoot = join(dirname(root), 'provider-clis') }
export function providerRuntimeHome(provider: AgentProvider) { return join(runtimesRoot, provider) }
/** The Antigravity runtime Ramu downloaded itself: `active.json` names the version directory that holds the executable and its helper. */
export const antigravityFileNames = () => process.platform === 'win32' ? { executable: 'agy_acp_server.exe', harness: 'localharness_external.exe' } : { executable: 'agy_acp_server.par', harness: 'localharness_external' }
export function managedAntigravity(): { executable: string; harness: string; version: string } | null {
  try {
    const home = providerRuntimeHome('antigravity')
    const version = JSON.parse(readFileSync(join(home, 'active.json'), 'utf8'))?.version
    if (typeof version !== 'string' || !/^[\w.-]{1,40}$/.test(version)) return null
    const names = antigravityFileNames(), directory = join(home, 'versions', version)
    const executable = join(directory, names.executable), harness = join(directory, names.harness)
    return existsSync(executable) && existsSync(harness) ? { executable, harness, version } : null
  } catch { return null }
}
export function providerAccountId(provider: AgentProvider) { return configuration[provider]?.accountId || 'default' }
export function providerAccountClearedEnv(provider: AgentProvider): string[] {
  return provider === 'claude-code' ? ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] : provider === 'cursor' ? ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'] : provider === 'antigravity' ? ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] : provider === 'codex' ? ['OPENAI_API_KEY', 'CODEX_API_KEY'] : provider === 'opencode' ? ['OPENCODE_DB', 'OPENCODE_AUTH_CONTENT', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'CEREBRAS_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'] : []
}
/** Environment variables that point a CLI at one account's own config and credential directory. */
export function providerAccountEnv(provider: AgentProvider, root: string): Record<string, string> {
  switch (provider) {
    case 'codex': return { CODEX_HOME: root }
    case 'opencode': return { XDG_DATA_HOME: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state') }
    case 'claude-code': return { CLAUDE_CONFIG_DIR: root }
    case 'cursor': return { CURSOR_CONFIG_DIR: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), AGENT_CLI_CREDENTIAL_STORE: 'file' }
    case 'antigravity': return { GEMINI_HOME: root }
  }
}
/** Creates the account's directories. A Claude account keeps your user-level settings, skills and agents by linking them in; credentials and history stay its own. */
export function prepareProviderAccount(provider: AgentProvider, root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const value of Object.values(providerAccountEnv(provider, root))) if (value.startsWith(root) && value !== root) mkdirSync(value, { recursive: true, mode: 0o700 })
  if (provider !== 'claude-code') return
  const shared = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  for (const name of ['settings.json', 'CLAUDE.md', 'skills', 'agents', 'commands']) {
    const source = join(shared, name), target = join(root, name)
    if (existsSync(source) && !existsSync(target) && shared !== root) try { symlinkSync(source, target) } catch {}
  }
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
  if (provider === 'antigravity') { const runtime = managedAntigravity(); if (runtime) return runtime.executable }
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
    prepareProviderAccount(provider, root)
    Object.assign(env, providerAccountEnv(provider, root))
    for (const key of providerAccountClearedEnv(provider)) delete env[key]
  }
  if (provider !== 'antigravity') return env
  const custom = overrides.antigravity?.harness?.trim()
  const sibling = join(dirname(providerBinary(provider, overrides)), process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external')
  const helper = custom ? expand(custom) : process.env.ANTIGRAVITY_HARNESS_PATH || (existsSync(sibling) ? sibling : undefined)
  return { ...env, ...(helper ? { ANTIGRAVITY_HARNESS_PATH: helper } : {}) }
}
