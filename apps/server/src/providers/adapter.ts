import type { AntigravitySignIn } from '@ramu/shared/providers/environment'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { ProviderConfiguration, ProviderSignIn, ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import type { SelectionTransition } from './selectionTransition'
import type { ProviderBrowserCapability } from '@ramu/shared/browser'
import type { Ability } from '@ramu/shared/providers/abilities'

export const parseProviderVersion = (output: string): string | null =>
  output.match(/\b\d{4}\.\d{2}\.\d{2}-[a-z0-9]+\b/i)?.[0] ??
  output.match(/\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1] ??
  null

/** Runs a CLI to completion and returns its combined output. Never rejects. */
export const runCli = (binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(binary, args, { timeout: 8000, maxBuffer: 64 * 1024, windowsHide: true, env }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: `${stdout}${stderr}` }),
    )
  })

export type ProviderSetup = Pick<
  ProviderStatus,
  'docsUrl' | 'installCommand' | 'updateCommand' | 'setupCommand' | 'setupNote'
>

export interface LatestRelease {
  version?: string
  downloadUrl?: string
}

/** How one provider's CLI is updated: a shell-free command, or an in-process installer. */
export type UpdatePlan = { command: string; args: string[] } | { install: () => Promise<void> }

/** Shared helpers handed to adapter hooks so adapters never import the modules that import them. */
export interface UpdateContext {
  config: ProviderConfiguration
  binary: string
  findExecutable: (command: string) => string | null
  runtimeHome: string
  /** Downloads and activates Ramu's managed runtime (Antigravity). */
  installRuntime: () => Promise<void>
  /** The exact release to install, for an adapter that can pin one (`pinsVersion`); otherwise the newest. */
  version?: string
  /** The release installed now, as the last status refresh read it; null when not known. */
  installedVersion?: string | null
}

/**
 * How a provider is pointed at Ramu's managed-skill export for one chat, without touching the user's own skill
 * directories or config. The export holds `.claude-plugin/plugin.json` and `skills/<ramu-name>/SKILL.md`.
 */
export interface SkillsLaunch {
  /** Local plugin directories (Claude Agent SDK `plugins`). */
  plugins?: string[]
  /** Skill folders merged into the provider's inline config (OpenCode `skills`). */
  configPaths?: string[]
  /** Skills folders the provider scans in the chat's working directory; Ramu links each `ramu-<name>` export folder into them. */
  linkDirs?: string[]
}

/**
 * An ability the runtime can provide and how Ramu invokes it: a built-in tool the model calls in a run limited to that
 * tool, or a model run with a context window of at least `contextWindow` tokens. A declaration is only a candidate: the host
 * offers it after a live check on the installed version passes.
 */
export interface AbilityDeclaration {
  ability: Ability
  /** A tool the step may use, the context window it needs, or images it reads in its prompt. */
  via: { tool: string } | { contextWindow: number } | { input: 'image' }
  /** Models that have it, by id; absent means the login's default model. */
  models?: string[]
}

/**
 * Features the provider has itself. Ramu uses them by default and adds its own tool only where the native one cannot
 * follow Ramu's flow (another provider or model, async answers, fallback across providers).
 */
export interface NativeFeatures {
  /** An advisor whose model Ramu can set per chat (Claude Code `advisorModel`). */
  advisor?: boolean
  /** A built-in blocking question tool whose requests reach Ramu (Claude `AskUserQuestion`, Codex `requestUserInput`). */
  blockingQuestions?: boolean
  /**
   * Verified live to deliver a generated title during a normal session. Ramu then waits through the first turn and a
   * short grace period before its own generation. Leave unset until verified: titles are still accepted when offered.
   */
  titles?: boolean
  /**
   * The runtime runs commands through Ramu's ACP client terminals (`terminal/*`), which the host then owns as background
   * terminals. Leave unset until the provider is verified to use them: advertising the capability changes how it runs shell
   * commands.
   */
  terminals?: boolean
  /** Abilities other providers' threads can borrow through Ramu's ability tools, and that this provider's own threads have. */
  abilities?: AbilityDeclaration[]
  /**
   * The runtime runs code that calls MCP tools itself (OpenCode's `execute`). Ramu's `run_script` would only run nested
   * inside it, so the thread keeps its own.
   */
  toolScripts?: boolean
  /**
   * The runtime keeps MCP tools out of the prompt and finds them on demand itself (Claude's ToolSearch, Codex's
   * tool_search, OpenCode's execute catalog). Ramu then lists its tools directly instead of behind its own tool_search,
   * which would only add a second search and hide each tool's name from the runtime's approvals.
   */
  toolSearch?: boolean
}

/** The smallest context window that counts as the long_context ability. */
export const LONG_CONTEXT_TOKENS = 400_000

/** Everything that varies per provider. Shared mechanics (spawning, caching, timeouts) stay in providers.ts / providerBinaries.ts. */
export interface ProviderAdapter {
  readonly browser: ProviderBrowserCapability
  readonly id: AgentProvider
  /** How new settings reach an existing native session; a live runner may refine this using negotiated capabilities. */
  readonly selectionTransition: SelectionTransition
  /** Environment variable that overrides the executable path. */
  readonly binaryEnvVar: string
  /** Executable file names searched on PATH and in `searchDirs`; the first is the fallback. */
  executableNames(): string[]
  searchDirs(home: string): string[]
  /** A Ramu-managed executable that outranks the default lookup, if one is installed. */
  managedBinary?(runtimeHome: string): string | null
  /** Variables pointing the CLI at one account's own config and credential directory. */
  accountEnv(root: string): Record<string, string>
  /** Credential variables removed when running as a non-default account. */
  readonly accountClearedEnv: string[]
  /** Extra account directory preparation beyond creating the directories. */
  prepareAccount?(root: string): void
  /** Final environment adjustments applied to every provider environment. */
  extendEnvironment?(
    env: NodeJS.ProcessEnv,
    ctx: { overrides: ProviderConfiguration; binary: () => string; expand: (path: string) => string },
  ): NodeJS.ProcessEnv
  setup(version: string | null): ProviderSetup
  /** Looks up the newest published release. */
  latestRelease(current: string | null, fetchText: (url: string) => Promise<string>): Promise<LatestRelease>
  /** Reads the installed version; resolves null when the output is unrecognizable. */
  probeVersion(binary: string, env: NodeJS.ProcessEnv): Promise<string | null>
  signInState(binary: string, env: NodeJS.ProcessEnv): Promise<ProviderSignIn>
  /** Arguments for the interactive terminal login, or null when sign-in does not run in a terminal. */
  readonly loginArgs: string[] | null
  /** Sign-in that runs inside Ramu instead of a terminal command. */
  signIn?(ctx: {
    installed: boolean
    accountId: string
    /** The account's provider environment, including where it keeps its own login. */
    env: NodeJS.ProcessEnv
    acpSignIn: (provider: 'antigravity', methodId: string, accountId: string) => Promise<void>
    /** The sign-in method the person chose, for runtimes that offer more than one. */
    method?: AntigravitySignIn
  }): Promise<void>
  /**
   * Saves an API key in the CLI's own credential store, for CLIs that read it from there rather than the environment;
   * `key` null signs that login out. Without this hook Ramu keeps the key and passes it in the environment.
   */
  storeApiKey?(ctx: { binary: string; env: NodeJS.ProcessEnv; key: string | null }): Promise<void>
  readonly native?: NativeFeatures
  /** Loads the managed-skill export through the provider's own skills. `cwd`, when known, is the chat's working directory for providers that scan one. */
  skillsLaunch?(exportDir: string, cwd?: string): SkillsLaunch
  /** Decides how to update; throws when this installation cannot be updated by Ramu. */
  updatePlan(ctx: UpdateContext): UpdatePlan
  /** The update installs the exact `version` it is given, so an older release that has waited can be installed. */
  readonly pinsVersion?: boolean
}

type AdapterDefaults = Pick<ProviderAdapter, 'searchDirs' | 'probeVersion'>

export const defaultSearchDirs = (home: string) => [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']

/** `--version` probe shared by every CLI-based provider. */
export const probeCliVersion = (binary: string, env: NodeJS.ProcessEnv): Promise<string | null> =>
  new Promise((resolve, reject) => {
    execFile(binary, ['--version'], { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, env }, (error, stdout) =>
      error
        ? reject(new Error('The binary could not report its version. Check its path and permissions.'))
        : resolve(parseProviderVersion(stdout)),
    )
  })

const adapterDefaults: AdapterDefaults = { searchDirs: defaultSearchDirs, probeVersion: probeCliVersion }

/** Fills in the behavior most providers share; an adapter only states what differs. */
export const defineAdapter = (
  adapter: Omit<ProviderAdapter, keyof AdapterDefaults> & Partial<AdapterDefaults>,
): ProviderAdapter => ({ ...adapterDefaults, ...adapter })

/** Latest-version lookup from the npm registry. */
export const npmLatest =
  (pkg: (current: string | null) => string): ProviderAdapter['latestRelease'] =>
  async (current, fetchText) => ({
    version: JSON.parse(await fetchText(`https://registry.npmjs.org/${encodeURIComponent(pkg(current))}/latest`))
      .version,
  })

/** The update every CLI offers itself: `<binary> <args>` after verifying the binary exists. */
export const selfUpdate =
  (args: string[]): ProviderAdapter['updatePlan'] =>
  ({ binary, findExecutable }) => {
    if (!findExecutable(binary)) throw new Error('Select an installed CLI before updating it.')
    return { command: binary, args }
  }
