import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { AgentProvider } from '../shared/types'
import type { ProviderConfiguration } from '../shared/providers'

let configuration: ProviderConfiguration = {}
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
  const names = { 'claude-code': ['claude'], codex: ['codex'], opencode: ['opencode'], cursor: ['agent', 'cursor-agent'], antigravity: [process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par'] }[provider]
  const dirs = provider === 'opencode' ? [join(homedir(), '.opencode/bin'), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'] : [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  return dirs.flatMap((dir) => names.map((name) => join(dir, name))).find(existsSync) ?? names.map(findExecutable).find((path) => !!path) ?? names[0]!
}
export function providerEnvironment(provider: AgentProvider, overrides = configuration): NodeJS.ProcessEnv {
  if (provider !== 'antigravity') return process.env
  const custom = overrides.antigravity?.harness?.trim()
  const sibling = join(dirname(providerBinary(provider, overrides)), process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external')
  const helper = custom ? expand(custom) : process.env.ANTIGRAVITY_HARNESS_PATH || (existsSync(sibling) ? sibling : undefined)
  return { ...process.env, ...(helper ? { ANTIGRAVITY_HARNESS_PATH: helper } : {}) }
}
