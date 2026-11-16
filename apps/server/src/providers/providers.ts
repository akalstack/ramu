import type { AntigravitySignIn } from '@ramu/shared/providers/environment'
import type { ActivityService } from '../background/activity'
import { execFile } from 'node:child_process'
import {
  AGENT_PROVIDERS,
  providerEnabled,
  supportsProviderAccounts,
  type ProviderConfiguration,
  type ProviderSignIn,
  type ProviderStatus,
} from '@ramu/shared/providers/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { acpPlan, acpSignIn } from './acp'
import { parseProviderVersion } from './adapter'
import { providerAdapter } from './adapters'
import {
  configureProviderBinaries,
  findExecutable,
  prepareProviderAccount,
  providerAccountClearedEnv,
  providerAccountEnv,
  providerAccountHome,
  providerRuntimeHome,
  providerApiKey,
  providerBinary,
  providerEnvironment,
} from './providerBinaries'
import type { ProviderApiKeyStore } from './apiKeyStore'
import { supportsApiKey } from '@ramu/shared/providers/apiKeys'
import { offeredVersion, recordSeen, settlesAt, type SeenVersions } from '@ramu/shared/updates'

type Release = { version: string; checkedAt: string; downloadUrl?: string }
type Cache = Partial<Record<AgentProvider, Release>>
type Seen = Partial<Record<AgentProvider, SeenVersions>>
export { parseProviderVersion }
import { newerVersion } from '@ramu/shared/version'
import { launchCompatibility } from './launchCompatibility'
import { installAntigravity } from './antigravityInstall'
export { newerVersion }
export function providerSetup(
  provider: AgentProvider,
  version: string | null,
): Pick<ProviderStatus, 'docsUrl' | 'installCommand' | 'updateCommand' | 'setupCommand' | 'setupNote'> {
  return providerAdapter(provider).setup(version)
}
async function officialText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Ramu-provider-updates', Accept: 'application/json, text/plain' },
  })
  if (!response.ok) throw new Error(`Release source returned HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('Release response too large')
  return text
}
export async function latestProviderRelease(provider: AgentProvider, current: string | null): Promise<Release> {
  const { version, downloadUrl } = await providerAdapter(provider).latestRelease(current, officialText)
  if (!version || !parseProviderVersion(version))
    throw new Error('Release source did not provide a recognizable version')
  return { version, checkedAt: new Date().toISOString(), ...(downloadUrl ? { downloadUrl } : {}) }
}
/** Asks the CLI itself whether it holds a login, without starting a chat. Details are shown only to the user who owns the login. */
export const signInState = (provider: AgentProvider, binary: string, env: NodeJS.ProcessEnv): Promise<ProviderSignIn> =>
  providerAdapter(provider).signInState(binary, env)

export class ProviderService {
  private timer: NodeJS.Timeout | undefined
  private closed = false
  private automaticRunning = false
  private generation = 0
  private statusCache?: { key: string; at: number; result: Promise<ProviderStatus[]> }
  private statusConfiguration = ''
  private releases: Cache
  /** When each provider's releases were first seen, which is when their waiting period starts. */
  private seen: Seen
  private dismissed: Record<string, boolean>
  private updating = new Map<AgentProvider, Promise<ProviderStatus>>()
  private updateErrors = new Map<AgentProvider, string>()
  /** Kept ability checks, shown with each provider's compatibility; the host sets this. */
  abilityChecks: (provider: AgentProvider) => import('@ramu/shared/providers/abilities').AbilityCheck[] = () => []
  constructor(
    private preferences: () => Pick<AppPreferences, 'providerBinaries' | 'providerUpdateChecks'> &
      Partial<Pick<AppPreferences, 'updateWait'>>,
    private read: <T>(key: string, fallback: T) => T,
    private write: (key: string, value: unknown) => void,
    private emit: (statuses: ProviderStatus[]) => void,
    private activity?: ActivityService,
  ) {
    this.releases = read<Cache>('provider-releases', {})
    this.seen = read<Seen>('provider-versions-seen', {})
    this.dismissed = read<Record<string, boolean>>('provider-updates-dismissed', {})
    this.settingsChanged()
  }
  settingsChanged() {
    const config = this.preferences().providerBinaries ?? {}
    const key = JSON.stringify(config)
    if (key !== this.statusConfiguration) {
      this.statusCache = undefined
      launchCompatibility.invalidate()
    }
    this.statusConfiguration = key
    configureProviderBinaries(config)
    this.generation++
    clearTimeout(this.timer)
    if (this.shouldCheck() && !this.closed) {
      this.timer = setTimeout(() => void this.automatic(), 30_000)
      this.timer.unref()
    } else this.emit([])
  }
  private async automatic() {
    if (this.closed || !this.shouldCheck()) return
    if (!this.automaticRunning) {
      this.automaticRunning = true
      const generation = this.generation
      try {
        let statuses = await this.status(undefined, true, false)
        if (!this.closed && generation === this.generation) {
          for (const status of statuses)
            if (
              status.updateAvailable &&
              status.updateCompatibility?.status !== 'incompatible' &&
              this.preferences().providerBinaries[status.provider]?.autoUpdate
            )
              await this.update(status.provider).catch(() => {})
          if (statuses.some((status) => this.preferences().providerBinaries[status.provider]?.autoUpdate))
            statuses = await this.status()
          if (!this.closed && generation === this.generation && this.preferences().providerUpdateChecks)
            this.emit(this.notices(statuses))
        }
      } catch {
      } finally {
        this.automaticRunning = false
      }
    }
    if (!this.closed && this.shouldCheck()) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.automatic(), 6 * 60 * 60 * 1000)
      this.timer.unref()
    }
  }
  private shouldCheck() {
    return (
      this.preferences().providerUpdateChecks ||
      Object.values(this.preferences().providerBinaries).some((config) => config?.autoUpdate)
    )
  }
  loginCommand(provider: AgentProvider, config = this.preferences().providerBinaries): string | null {
    const args = providerAdapter(provider).loginArgs
    if (!args) return null
    const id = config[provider]?.accountId || 'default'
    const env = providerEnvironment(provider, config, id)
    if (id !== 'default') {
      const root = providerAccountHome(provider, id)
      prepareProviderAccount(provider, root)
    }
    const quote = (value: string) => `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\"'\"'")}'`
    const keys = Object.keys(providerAccountEnv(provider, providerAccountHome(provider, id === 'default' ? 'x' : id)))
    const assignments =
      id === 'default'
        ? ''
        : keys
            .map((key) =>
              process.platform === 'win32' ? `$env:${key}=${quote(env[key]!)}; ` : `${key}=${quote(env[key]!)}`,
            )
            .join(process.platform === 'win32' ? '' : ' ') + ' '
    const cleared = providerAccountClearedEnv(provider)
    const clean =
      id === 'default' || !cleared.length
        ? ''
        : process.platform === 'win32'
          ? `Remove-Item ${cleared.map((key) => `Env:${key}`).join(',')} -ErrorAction SilentlyContinue; `
          : `env ${cleared.map((key) => `-u ${key}`).join(' ')} `
    return `${clean}${assignments}${process.platform === 'win32' ? '& ' : ''}${quote(providerBinary(provider, config))} ${args.join(' ')}`
  }
  /** The plan each login was last seen on, so an upgrade or downgrade is noticed when it happens. */
  private plans = new Map<string, string>()
  /** Told when a login's plan changed, so its models and usage are read again. */
  onPlanChange?: (provider: AgentProvider, accountId: string) => void
  /** A login's identity may have changed: another account signed in, or a key was set or removed. */
  onLoginChange?: (provider: AgentProvider, accountId: string) => void
  private notePlan(provider: AgentProvider, accountId: string, plan: string | undefined) {
    if (!plan) return
    const key = `${provider}:${accountId}`,
      before = this.plans.get(key)
    this.plans.set(key, plan)
    if (before && before !== plan) this.onPlanChange?.(provider, accountId)
  }
  private logins = new Map<string, { at: number; email?: string; apiKey?: boolean }>()
  /**
   * Each login's sign-in email and whether it runs on an API key, read at most every ten minutes, for naming logins
   * that have no label. A login with neither is named by its position.
   */
  async accountLogins(): Promise<Record<string, Record<string, { email?: string; apiKey?: boolean }>>> {
    const config = this.preferences().providerBinaries ?? {}
    const result: Record<string, Record<string, { email?: string; apiKey?: boolean }>> = {}
    await Promise.all(
      AGENT_PROVIDERS.map(async (provider) => {
        const binary = providerBinary(provider, config)
        if (!providerEnabled(config, provider) || !findExecutable(binary)) return
        const ids = ['default', ...(config[provider]?.accounts ?? []).map((account) => account.id)]
        await Promise.all(
          ids.map(async (id) => {
            const key = `${provider}:${id}`
            let hit = this.logins.get(key)
            if (!hit || Date.now() - hit.at > 10 * 60_000) {
              const state = await signInState(provider, binary, providerEnvironment(provider, config, id)).catch(
                () => undefined,
              )
              const apiKey = !!state?.signedIn && (!!state.apiKey || !!providerApiKey(provider, id))
              hit = { at: Date.now(), ...(state?.email ? { email: state.email } : {}), ...(apiKey ? { apiKey } : {}) }
              this.logins.set(key, hit)
            }
            if (hit.email || hit.apiKey)
              (result[provider] ??= {})[id] = {
                ...(hit.email ? { email: hit.email } : {}),
                ...(hit.apiKey ? { apiKey: true } : {}),
              }
          }),
        )
      }),
    )
    return result
  }
  /** Logins known to run on an API key, as `provider:account`: keys saved in Ramu, and logins last read as using one. */
  apiKeyLogins(): Set<string> {
    const config = this.preferences().providerBinaries ?? {}
    const keys = new Set([...this.logins].flatMap(([key, login]) => (login.apiKey ? [key] : [])))
    for (const provider of AGENT_PROVIDERS)
      for (const id of ['default', ...(config[provider]?.accounts ?? []).map((account) => account.id)])
        if (providerApiKey(provider, id)) keys.add(`${provider}:${id}`)
    return keys
  }
  /**
   * Reads every login again, as when a person refreshes Providers after signing one in from a terminal: a login now on
   * another account is reported like a sign-in through Ramu.
   */
  private async relogin(): Promise<void> {
    const before = new Map([...this.logins].map(([key, login]) => [key, `${login.email ?? ''}:${!!login.apiKey}`]))
    this.logins.clear()
    await this.accountLogins().catch(() => undefined)
    for (const [key, login] of this.logins) {
      const previous = before.get(key)
      if (previous === undefined || previous === `${login.email ?? ''}:${!!login.apiKey}`) continue
      const [provider, accountId] = key.split(':') as [AgentProvider, string]
      this.onLoginChange?.(provider, accountId)
    }
  }
  /** The sign-in email of each login that reports one, for naming accounts without a label. */
  async accountEmails(): Promise<Record<string, Record<string, string>>> {
    const logins = await this.accountLogins()
    return Object.fromEntries(
      Object.entries(logins).map(([provider, byId]) => [
        provider,
        Object.fromEntries(Object.entries(byId).flatMap(([id, login]) => (login.email ? [[id, login.email]] : []))),
      ]),
    )
  }

  async signIn(provider: AgentProvider, accountId = 'default', method?: AntigravitySignIn): Promise<void> {
    const adapter = providerAdapter(provider)
    if (!adapter.signIn) throw new Error('Use the Login command for this provider.')
    this.statusCache = undefined
    await adapter.signIn({
      installed: !!findExecutable(providerBinary(provider, this.preferences().providerBinaries)),
      accountId,
      env: providerEnvironment(provider, this.preferences().providerBinaries, accountId),
      acpSignIn,
      method,
    })
    this.statusCache = undefined
    // Signing in may put a different account behind this login: its cached email and usage are no longer its own.
    this.logins.delete(`${provider}:${accountId}`)
    this.onLoginChange?.(provider, accountId)
  }
  /**
   * Signs one login in with an API key, or with `key` null removes it so the login falls back to its subscription.
   * CLIs that keep keys in their own login file get it there; for the rest Ramu keeps it in the host credential store.
   */
  async setApiKey(
    provider: AgentProvider,
    accountId: string,
    variable: string,
    key: string | null,
    keys: ProviderApiKeyStore,
  ): Promise<void> {
    if (!supportsApiKey(provider)) throw new Error('This provider signs in another way')
    const config = this.preferences().providerBinaries
    if (accountId !== 'default' && !config?.[provider]?.accounts?.some((account) => account.id === accountId))
      throw new Error('The selected provider account no longer exists')
    const adapter = providerAdapter(provider)
    this.statusCache = undefined
    if (adapter.storeApiKey) {
      const binary = providerBinary(provider, config)
      if (!findExecutable(binary)) throw new Error('Install the provider first.')
      await adapter.storeApiKey({ binary, env: providerEnvironment(provider, config, accountId), key })
    } else await keys.set(provider, accountId, variable, key)
    this.logins.delete(`${provider}:${accountId}`)
    this.statusCache = undefined
    this.onLoginChange?.(provider, accountId)
  }
  private noteRelease(provider: AgentProvider, release: Release) {
    this.seen[provider] = recordSeen(this.seen[provider] ?? {}, release.version)
  }
  /** The release offered now: the newest, or with waiting on, the newest that has been out a day. */
  private offered(provider: AgentProvider, latest: string) {
    return offeredVersion(this.seen[provider] ?? {}, latest, {
      wait: this.preferences().updateWait !== false,
      pins: !!providerAdapter(provider).pinsVersion,
    })
  }
  /**
   * Shell-free updater, shared by manual actions and the detached service timer. It installs the release that has
   * waited; a CLI that can only update to its newest release is held while that one is still waiting, checked again
   * just before it runs. `now` installs the newest release at once, for a fix that cannot wait.
   */
  update(provider: AgentProvider, now = false): Promise<ProviderStatus> {
    const pending = this.updating.get(provider)
    if (pending) return pending
    const waiting = this.preferences().updateWait !== false && !now
    const pins = !!providerAdapter(provider).pinsVersion
    // Never install a release this policy already knows cannot work; the card explains the manual path instead.
    const known =
      (waiting ? this.offered(provider, this.releases[provider]?.version ?? '') : null) ??
      this.releases[provider]?.version
    const target = launchCompatibility.target(provider, known ?? null)
    if (target?.status === 'incompatible')
      return Promise.reject(
        new Error(
          `The latest ${provider} release (${known}) is not compatible with this Ramu release. Install a compatible version manually${target.recommend ? ` (${target.recommend})` : ''}.`,
        ),
      )
    const controller = new AbortController()
    const update = async () => {
      const config = this.preferences().providerBinaries
      let version: string | undefined
      if (waiting) {
        // Read the newest release again: one published since the last check must not slip in through the updater.
        const current = this.releases[provider]?.version
        const fresh = await latestProviderRelease(provider, current ?? null).catch(() => this.releases[provider])
        if (fresh) {
          this.releases[provider] = { ...fresh }
          this.noteRelease(provider, fresh)
          this.write('provider-releases', this.releases)
          this.write('provider-versions-seen', this.seen)
        }
        const offered = fresh ? this.offered(provider, fresh.version) : null
        if (!offered || (!pins && offered !== fresh?.version)) {
          const firstSeen = fresh ? this.seen[provider]?.[fresh.version] : undefined
          throw new Error(
            `${fresh?.version ?? 'The newest release'} came out less than a day ago${firstSeen ? ` and is offered from ${settlesAt(firstSeen)}` : ''}. Choose Update now to install it anyway.`,
          )
        }
        if (pins) version = offered
      }
      const plan = providerAdapter(provider).updatePlan({
        version,
        config,
        binary: providerBinary(provider, config),
        findExecutable,
        runtimeHome: providerRuntimeHome(provider),
        installRuntime: async () => {
          await installAntigravity({ signal: controller.signal })
        },
      })
      this.updateErrors.delete(provider)
      if ('install' in plan) await plan.install()
      else
        await new Promise<void>((resolve, reject) =>
          execFile(
            plan.command,
            plan.args,
            {
              timeout: 5 * 60_000,
              maxBuffer: 1024 * 1024,
              windowsHide: true,
              env: providerEnvironment(provider, config),
            },
            (error) =>
              error
                ? reject(
                    new Error('CLI update failed. Check permissions, network access, and how this CLI was installed.'),
                  )
                : resolve(),
          ),
        )
      this.statusCache = undefined
      launchCompatibility.invalidate(provider)
      return (await this.status()).find((status) => status.provider === provider)!
    }
    const work = (
      this.activity
        ? this.activity.run(
            'Updating CLI',
            provider,
            update,
            provider === 'antigravity' ? () => controller.abort() : undefined,
          )
        : update()
    )
      .catch((error) => {
        if (controller.signal.aborted) throw new Error('CLI update cancelled.')
        this.updateErrors.set(provider, (error as Error).message)
        throw error
      })
      .finally(() => {
        this.updating.delete(provider)
        this.statusCache = undefined
      })
    this.updating.set(provider, work)
    return work
  }
  private key(s: ProviderStatus) {
    return `${s.provider}:${s.binary}:${s.latestVersion}`
  }
  /** Updates to offer, and releases still waiting out their day so devices can say when they come (or install now). */
  notices(statuses: ProviderStatus[]) {
    return statuses.filter((s) => (s.updateAvailable || s.waitingVersion) && !this.dismissed[this.key(s)])
  }
  dismiss(status: ProviderStatus) {
    this.dismissed[this.key(status)] = true
    this.write('provider-updates-dismissed', this.dismissed)
  }
  async updates() {
    return this.preferences().providerUpdateChecks ? this.notices(await this.status()) : []
  }
  status(
    overrides?: ProviderConfiguration,
    checkLatest = false,
    force = true,
    refresh = false,
  ): Promise<ProviderStatus[]> {
    const key = JSON.stringify(overrides ?? this.preferences().providerBinaries ?? {})
    if (refresh) void this.relogin()
    // Automatic release checks omit login probes, so they must not replace the full settings result.
    if (!refresh && !checkLatest && force && this.statusCache?.key === key && Date.now() - this.statusCache.at < 60_000)
      return this.statusCache.result
    const work = () => this.readStatus(overrides, checkLatest, force)
    const result = checkLatest && this.activity ? this.activity.run('Checking CLI updates', undefined, work) : work()
    if (force) {
      const entry = { key, at: Date.now(), result }
      this.statusCache = entry
      void result.then(
        () => {
          entry.at = Date.now()
        },
        () => {
          if (this.statusCache === entry) this.statusCache = undefined
        },
      )
    }
    return result
  }
  /**
   * One provider's status with its logins, for Settings after a change to that provider alone (a login added, renamed
   * or signed in), so every other provider keeps its result instead of being probed again.
   */
  async statusOf(provider: AgentProvider, overrides?: ProviderConfiguration): Promise<ProviderStatus> {
    const [status] = await this.readStatus(overrides, false, true, [provider])
    return status!
  }
  private async readStatus(
    overrides?: ProviderConfiguration,
    checkLatest = false,
    force = true,
    only: readonly AgentProvider[] = AGENT_PROVIDERS,
  ): Promise<ProviderStatus[]> {
    const config = overrides ?? this.preferences().providerBinaries ?? {}
    const statuses = await Promise.all(
      only.map(async (provider): Promise<ProviderStatus> => {
        const binary = providerBinary(provider, config),
          installed = !!findExecutable(binary)
        let version: string | null = null,
          error: string | undefined,
          versionError: string | undefined
        if (installed) {
          try {
            version = await providerAdapter(provider).probeVersion(binary, providerEnvironment(provider, config))
            if (!version) versionError = 'The binary did not report a recognizable version.'
          } catch (reason) {
            versionError = String((reason as Error).message)
          }
        }
        let release = this.releases[provider]
        if (
          checkLatest &&
          (force || !release || Date.now() - Date.parse(release.checkedAt) > 24 * 60 * 60 * 1000) &&
          (installed || force)
        ) {
          try {
            release = await latestProviderRelease(provider, version)
            this.releases[provider] = release
            this.noteRelease(provider, release)
          } catch (reason) {
            error = `Latest version check failed: ${(reason as Error).message}`
          }
        }
        let signIn: Record<string, ProviderSignIn> | undefined
        if (force && installed) {
          signIn = {}
          const ids = [
            'default',
            ...(supportsProviderAccounts(provider)
              ? (config[provider]?.accounts ?? []).map((account) => account.id)
              : []),
          ]
          await Promise.all(
            ids.map(async (accountId) => {
              try {
                const state = await signInState(provider, binary, providerEnvironment(provider, config, accountId))
                // Antigravity says its plan only when a session opens; the last one it named stands in.
                const acp = provider === 'antigravity' && state.signedIn ? acpPlan(provider, accountId) : undefined
                signIn![accountId] = {
                  ...(acp && !state.plan ? { ...state, ...acp } : state),
                  ...(state.signedIn && providerApiKey(provider, accountId) ? { apiKey: true } : {}),
                }
                this.notePlan(provider, accountId, signIn![accountId]!.plan)
              } catch {
                signIn![accountId] = { signedIn: false }
              }
            }),
          )
        }
        // What is offered is the release that has waited; a newer one still waiting is reported beside it.
        const offered = release ? this.offered(provider, release.version) : null
        const firstSeen = release ? this.seen[provider]?.[release.version] : undefined
        const waitingVersion =
          release && version && offered !== release.version && newerVersion(release.version, version)
            ? release.version
            : undefined
        const compatibility = installed ? launchCompatibility.observe(provider, binary, version) : null
        const updateCompatibility =
          installed && version && offered && newerVersion(offered, version)
            ? launchCompatibility.target(provider, offered)
            : null
        const setup = providerSetup(provider, version)
        const quoted =
          process.platform === 'win32'
            ? `& '${binary.replaceAll("'", "''")}'`
            : `'${binary.replaceAll("'", "'\"'\"'")}'`
        const useBinary = (command: string | null) =>
          command?.replace(/^(claude|codex|agent|opencode)(?= |$)/, () => quoted) ?? null
        setup.setupCommand = useBinary(setup.setupCommand)
        setup.updateCommand = useBinary(setup.updateCommand)
        return {
          provider,
          browser: providerAdapter(provider).browser,
          binary,
          installed,
          version,
          enabled: providerEnabled(config, provider),
          ...(signIn ? { signIn } : {}),
          ...(compatibility ? { compatibility } : {}),
          ...(updateCompatibility ? { updateCompatibility } : {}),
          ...(installed && this.abilityChecks(provider).length ? { abilities: this.abilityChecks(provider) } : {}),
          accountsSupported: supportsProviderAccounts(provider),
          updating: this.updating.has(provider),
          ...(this.updateErrors.has(provider) ? { updateError: this.updateErrors.get(provider) } : {}),
          latestVersion: offered ?? (waitingVersion ? version : (release?.version ?? null)),
          checkedAt: release?.checkedAt ?? null,
          updateAvailable: !!(installed && version && offered && newerVersion(offered, version)),
          ...(waitingVersion ? { waitingVersion, ...(firstSeen ? { waitingUntil: settlesAt(firstSeen) } : {}) } : {}),
          ...(error ? { error } : {}),
          ...(versionError ? { versionError } : {}),
          ...(release?.downloadUrl ? { downloadUrl: release.downloadUrl } : {}),
          ...setup,
        }
      }),
    )
    if (checkLatest && !this.closed) {
      this.write('provider-releases', this.releases)
      this.write('provider-versions-seen', this.seen)
    }
    return statuses
  }
  close() {
    this.closed = true
    clearTimeout(this.timer)
  }
}
