import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { AgentProvider } from '@ramu/shared/types'
import type { ProviderConfiguration } from '@ramu/shared/providers/providers'
import { supportsProviderAccounts } from '@ramu/shared/providers/providers'
import { scopedEnvironment, type ProviderEnvironmentValues } from '@ramu/shared/providers/environment'
import { antigravityFileNames, managedAntigravityAt } from './adapters/antigravity'
import { providerAdapter } from './adapters'

let configuration: ProviderConfiguration = {}
let accountsRoot = join(homedir(), '.ramu', 'provider-accounts')
let runtimesRoot = join(homedir(), '.ramu', 'provider-clis')
export function configureProviderAccounts(root: string) {
  accountsRoot = root
  runtimesRoot = join(dirname(root), 'provider-clis')
}
export function providerRuntimeHome(provider: AgentProvider) {
  return join(runtimesRoot, provider)
}
export { antigravityFileNames }
export const managedAntigravity = () => managedAntigravityAt(providerRuntimeHome('antigravity'))
export function providerAccountId(provider: AgentProvider) {
  return configuration[provider]?.accountId || 'default'
}
export function providerAccountClearedEnv(provider: AgentProvider): string[] {
  return providerAdapter(provider).accountClearedEnv
}
/** Environment variables that point a CLI at one account's own config and credential directory. */
export function providerAccountEnv(provider: AgentProvider, root: string): Record<string, string> {
  return providerAdapter(provider).accountEnv(root)
}
/** Creates the account's directories. A Claude account keeps your user-level settings, skills and agents by linking them in; credentials and history stay its own. */
export function prepareProviderAccount(provider: AgentProvider, root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const value of Object.values(providerAccountEnv(provider, root)))
    if (value.startsWith(root) && value !== root) mkdirSync(value, { recursive: true, mode: 0o700 })
  providerAdapter(provider).prepareAccount?.(root)
}
export function providerAccountHome(provider: AgentProvider, id: string): string {
  if (!supportsProviderAccounts(provider) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || id === 'default')
    throw new Error('Invalid provider account')
  return join(accountsRoot, provider, id)
}
export function configureProviderBinaries(value: ProviderConfiguration) {
  configuration = value
}
let customEnvironment: ProviderEnvironmentValues = {}
/** Variables from Settings → Environment variables, loaded from the host credential store. */
export function configureProviderEnvironment(value: ProviderEnvironmentValues) {
  customEnvironment = value
}
const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
export function findExecutable(command: string): string | null {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .flatMap((dir) =>
          process.platform === 'win32'
            ? ['', '.exe', '.cmd'].map((ext) => join(dir, command + ext))
            : [join(dir, command)],
        )
  return (
    candidates.find((path) => {
      try {
        accessSync(path, constants.X_OK)
        return statSync(path).isFile()
      } catch {
        return false
      }
    }) ?? null
  )
}
export function providerBinary(provider: AgentProvider, overrides = configuration): string {
  const custom = overrides[provider]?.binary?.trim()
  if (custom) return expand(custom)
  const adapter = providerAdapter(provider)
  const env = process.env[adapter.binaryEnvVar]
  if (env) return expand(env)
  const managed = adapter.managedBinary?.(providerRuntimeHome(provider))
  if (managed) return managed
  const names = adapter.executableNames()
  return (
    adapter
      .searchDirs(homedir())
      .flatMap((dir) => names.map((name) => join(dir, name)))
      .find(existsSync) ??
    names.map(findExecutable).find((path) => !!path) ??
    names[0]!
  )
}
export function providerEnvironment(
  provider: AgentProvider,
  overrides = configuration,
  accountId = overrides[provider]?.accountId || 'default',
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  let accountEnv: Record<string, string> = {}
  if (accountId !== 'default') {
    if (!overrides[provider]?.accounts?.some((account) => account.id === accountId))
      throw new Error('The selected provider account no longer exists')
    const root = providerAccountHome(provider, accountId)
    // Credentials remain in the CLI's own store; Ramu stores only profile names/IDs.
    prepareProviderAccount(provider, root)
    accountEnv = providerAccountEnv(provider, root)
    Object.assign(env, accountEnv)
    for (const key of providerAccountClearedEnv(provider)) delete env[key]
  }
  // Variables set in Ramu win over the inherited shell; an account's own config folders still win over them.
  for (const [key, value] of Object.entries(scopedEnvironment(customEnvironment, provider)))
    if (!(key in accountEnv)) env[key] = value
  return (
    providerAdapter(provider).extendEnvironment?.(env, {
      overrides,
      binary: () => providerBinary(provider, overrides),
      expand,
    }) ?? env
  )
}
