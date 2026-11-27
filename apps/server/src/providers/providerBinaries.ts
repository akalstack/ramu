import { execFile } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { homedir, userInfo } from 'node:os'
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

/**
 * Whether this host has the login `id` for `provider`. A setting copied from another host can name an account added
 * there and never here.
 */
export function knownProviderAccount(provider: AgentProvider, id: string): boolean {
  const config = configuration[provider]
  return id === 'default' || id === config?.accountId || !!config?.accounts?.some((account) => account.id === id)
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
/** A variable set in Ramu for one provider rather than for all of them, such as Antigravity's `GEMINI_API_KEY`. */
export const providerVariable = (provider: AgentProvider, key: string): string | null =>
  customEnvironment[provider]?.find((entry) => entry.key === key)?.value || null

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
        // Version managers first: they put their folder ahead of Homebrew's in a shell, so a Node from one is the
        // Node the person's terminal runs. Their per-shell folders never reach an app.
        ...[
          process.env.FNM_DIR,
          join(homedir(), '.local/share/fnm'),
          join(homedir(), 'Library/Application Support/fnm'),
          join(homedir(), '.fnm'),
        ]
          .filter((dir): dir is string => !!dir)
          .map((dir) => join(dir, 'aliases/default/bin')),
        ...nvmDefaultBin(),
        join(homedir(), '.volta/bin'),
        join(homedir(), '.local/share/mise/shims'),
        join(homedir(), '.asdf/shims'),
        join(homedir(), '.nodenv/shims'),
        join(homedir(), '.nodebrew/current/bin'),
        ...(process.env.N_PREFIX ? [join(process.env.N_PREFIX, 'bin')] : []),
        // `pnpm env use --global` keeps Node in pnpm's own home.
        ...[process.env.PNPM_HOME, join(homedir(), 'Library/pnpm'), join(homedir(), '.local/share/pnpm')].filter(
          (dir): dir is string => !!dir,
        ),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        join(homedir(), '.local/bin'),
        join(homedir(), 'bin'),
        '/home/linuxbrew/.linuxbrew/bin',
        '/snap/bin',
      ]

const versionParts = (version: string) => version.slice(1).split('.').map(Number)
const newerFirst = (a: string, b: string) => {
  const [x, y] = [versionParts(a), versionParts(b)]
  return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!
}
/**
 * nvm has no fixed folder for its default Node: each version has its own, and `alias/default` names one as `22`,
 * `v22.11.0`, `node` or `lts/*` (which points at further alias files). An alias that names no installed version falls
 * back to the newest installed one, as a shell with that version uninstalled would have nothing better.
 */
function nvmDefaultBin(): string[] {
  const root = process.env.NVM_DIR || join(homedir(), '.nvm')
  let versions: string[]
  try {
    versions = readdirSync(join(root, 'versions/node'))
      .filter((version) => /^v\d+\.\d+\.\d+$/.test(version))
      .sort(newerFirst)
  } catch {
    return []
  }
  if (!versions.length) return []
  const readAlias = (name: string) => {
    try {
      return readFileSync(join(root, 'alias', name), 'utf8').trim()
    } catch {
      return null
    }
  }
  let alias = readAlias('default') ?? 'node'
  for (let hops = 0; hops < 3 && alias.startsWith('lts/'); hops++) alias = readAlias(alias) ?? alias
  const wanted = alias.replace(/^v/, '')
  const match = /^\d+(\.\d+){0,2}$/.test(wanted)
    ? versions.find((version) => version === `v${wanted}` || version.startsWith(`v${wanted}.`))
    : undefined
  return [join(root, 'versions/node', match ?? versions[0]!, 'bin')]
}

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
const PATH_MARKER = '__RAMU_PATH__'
/** The person's shell. A service started by the system may have no `SHELL`, so their account's shell stands in. */
const userShell = () => {
  if (process.env.SHELL) return process.env.SHELL
  try {
    if (userInfo().shell) return userInfo().shell!
  } catch {}
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}
/**
 * The PATH the person's own terminal has, for tools in folders Ramu does not know: their shell's startup files build
 * it (`fnm env`, sourcing nvm, an `export PATH=…` line in a profile or rc file), so only a login, interactive shell
 * reads them all. It can take seconds. Each folder is resolved to where it really is: fnm's lasts only as long as that
 * one shell, and links to the install that outlives it.
 */
export function loginShellPath(shell = userShell(), timeoutMs = 5000): Promise<string[]> {
  if (process.platform === 'win32') return Promise.resolve([])
  return new Promise((resolve) =>
    execFile(
      shell,
      // Startup files may print a greeting, so the answer follows a marker on its own line.
      ['-ilc', `printf '\\n${PATH_MARKER}%s\\n' "$PATH"`],
      // An interactive shell ignores SIGTERM, so a startup file that hangs is only ended by SIGKILL.
      { env: userEnvironment(), timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' },
      (_error, stdout) => {
        const line = String(stdout)
          .split('\n')
          .find((entry) => entry.startsWith(PATH_MARKER))
        const dirs = (line?.slice(PATH_MARKER.length).trim() ?? '').split(delimiter).flatMap((dir) => {
          if (!isAbsolute(dir)) return []
          try {
            return [realpathSync(dir)]
          } catch {
            return []
          }
        })
        resolve([...new Set(dirs)])
      },
    ),
  )
}

/**
 * Makes the person's tools reachable for everything Ramu starts. A service started by the system, not from a shell, gets
 * the bare system PATH: npm, npx, `gh` and provider CLIs looked missing, and a tool that begins with
 * `#!/usr/bin/env node` (npm itself, most CLIs installed with it) failed with "env: node: No such file or directory".
 * The login shell's folders go first, so a command finds the same tool it does in their terminal; a Node from a known
 * folder goes last, for when the shell gives no answer. Asks the shell each time, so a tool installed since is found.
 */
export async function ensureToolsOnPath(readShellPath: () => Promise<string[]> = loginShellPath): Promise<void> {
  if (process.platform === 'win32') return
  const shellDirs = await readShellPath()
  const current = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const found = [...new Set([...shellDirs, ...current])]
  process.env.PATH = found.join(delimiter)
  // Looked for once the shell's folders are in: a Node the person's own shell has needs no fallback after it.
  const node = findExecutable('node')
  if (node && !found.includes(dirname(node))) process.env.PATH = [...found, dirname(node)].join(delimiter)
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
