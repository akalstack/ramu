import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { AgentProvider } from '@ramu/shared/types'
import type { ProviderConfiguration } from '@ramu/shared/providers/providers'
import { supportsProviderAccounts } from '@ramu/shared/providers/providers'
import { scopedEnvironment, type ProviderEnvironmentValues } from '@ramu/shared/providers/environment'
import { managedAntigravityAt } from './adapters/antigravity'
import { providerAdapter } from './adapters'
import { userEnvironment } from '../userEnvironment'

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
export const managedAntigravity = () => managedAntigravityAt(providerRuntimeHome('antigravity'))
export function providerAccountId(provider: AgentProvider) {
  return configuration[provider]?.accountId || 'default'
}

let allowAccount: (provider: AgentProvider, accountId: string, taskId: string) => boolean = () => true

/** Which logins a thread may use: those of its project's identity and those for every identity. */
export function setAccountRestriction(allow: typeof allowAccount) {
  allowAccount = allow
}

/** The provider configuration with the logins a thread's identity may not use turned off. */
export function identityConfiguration(config: ProviderConfiguration, taskId: string): ProviderConfiguration {
  return Object.fromEntries(
    Object.entries(config).map(([provider, entry]) => {
      if (!entry) return [provider, entry]
      const id = provider as AgentProvider
      const accounts = entry.accounts?.map((account) =>
        allowAccount(id, account.id, taskId) ? account : { ...account, enabled: false },
      )
      const defaultAllowed = allowAccount(id, 'default', taskId)
      const primary = entry.accountId || 'default'
      const firstAllowed = [
        ...(defaultAllowed && entry.defaultAccountEnabled !== false ? ['default'] : []),
        ...(accounts ?? []).filter((account) => account.enabled !== false).map((account) => account.id),
      ][0]
      return [
        provider,
        {
          ...entry,
          ...(accounts ? { accounts } : {}),
          ...(defaultAllowed ? {} : { defaultAccountEnabled: false }),
          ...(allowAccount(id, primary, taskId) || !firstAllowed
            ? {}
            : { accountId: firstAllowed === 'default' ? undefined : firstAllowed }),
        },
      ]
    }),
  ) as ProviderConfiguration
}

/** The login a new thread in this task starts on: the chosen one, unless its identity may not use it. */
export function taskAccountId(provider: AgentProvider, taskId: string): string {
  const restricted = identityConfiguration(configuration, taskId)[provider]
  const chosen = restricted?.accountId || 'default'
  if (allowAccount(provider, chosen, taskId)) return chosen
  throw new Error(
    `No ${provider} login is for this project's identity. Connect one in Settings → Providers and put it in this identity.`,
  )
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
/** API keys saved for single logins: provider → account → the variable and the key. */
export type ProviderApiKeys = Partial<Record<AgentProvider, Record<string, { variable: string; value: string }>>>
let apiKeys: ProviderApiKeys = {}
export function configureProviderApiKeys(value: ProviderApiKeys) {
  apiKeys = value
}
/** Whether this login runs on a key Ramu saved for it. */
export const providerApiKey = (provider: AgentProvider, accountId: string) => apiKeys[provider]?.[accountId]
const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
/**
 * Where tools are installed that a desktop app's own PATH leaves out: an app opened from the Dock or a launcher gets the
 * system's bare PATH, without Homebrew or the person's own bin folders, so a tool they just installed would look missing.
 */
const usualToolDirs = () =>
  process.platform === 'win32'
    ? []
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        join(homedir(), '.local/bin'),
        join(homedir(), 'bin'),
        '/home/linuxbrew/.linuxbrew/bin',
        '/snap/bin',
      ]

export function findExecutable(command: string): string | null {
  const candidates = isAbsolute(command)
    ? [command]
    : [...new Set([...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...usualToolDirs()])].flatMap((dir) =>
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
  const usable = (path: string | null): path is string => !!path && (adapter.usable?.(path) ?? true)
  return (
    adapter
      .searchDirs(homedir())
      .flatMap((dir) => names.map((name) => join(dir, name)))
      .find((path) => existsSync(path) && usable(path)) ??
    names.map(findExecutable).find(usable) ??
    names[0]!
  )
}
export function providerEnvironment(
  provider: AgentProvider,
  overrides = configuration,
  accountId = overrides[provider]?.accountId || 'default',
  /** The folder the process works in, so it commits as that project's identity. */
  cwd?: string,
): NodeJS.ProcessEnv {
  const env = userEnvironment({}, cwd)
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
  // A key saved for this login wins over the same variable set for the whole provider.
  const saved = apiKeys[provider]?.[accountId]
  if (saved) env[saved.variable] = saved.value
  return (
    providerAdapter(provider).extendEnvironment?.(env, {
      overrides,
      binary: () => providerBinary(provider, overrides),
      expand,
    }) ?? env
  )
}
