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
import { acpSignIn } from './acp'
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
  providerBinary,
  providerEnvironment,
} from './providerBinaries'

type Release = { version: string; checkedAt: string; downloadUrl?: string }
type Cache = Partial<Record<AgentProvider, Release>>
export { parseProviderVersion }
import { newerVersion } from '@ramu/shared/version'
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
  private dismissed: Record<string, boolean>
  private updating = new Map<AgentProvider, Promise<ProviderStatus>>()
  private updateErrors = new Map<AgentProvider, string>()
  constructor(
    private preferences: () => Pick<AppPreferences, 'providerBinaries' | 'providerUpdateChecks'>,
    private read: <T>(key: string, fallback: T) => T,
    private write: (key: string, value: unknown) => void,
    private emit: (statuses: ProviderStatus[]) => void,
    private activity?: ActivityService,
  ) {
    this.releases = read<Cache>('provider-releases', {})
    this.dismissed = read<Record<string, boolean>>('provider-updates-dismissed', {})
    this.settingsChanged()
  }
  settingsChanged() {
    const config = this.preferences().providerBinaries ?? {}
    const key = JSON.stringify(config)
    if (key !== this.statusConfiguration) this.statusCache = undefined
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
            if (status.updateAvailable && this.preferences().providerBinaries[status.provider]?.autoUpdate)
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
  /** Providers whose sign-in runs inside Ramu instead of a terminal command. */
  private emails = new Map<string, { at: number; email?: string }>()
  /** The sign-in email of each login that reports one, read at most every ten minutes, for naming accounts without a label. */
  async accountEmails(): Promise<Record<string, Record<string, string>>> {
    const config = this.preferences().providerBinaries ?? {}
    const result: Record<string, Record<string, string>> = {}
    await Promise.all(
      AGENT_PROVIDERS.map(async (provider) => {
        const binary = providerBinary(provider, config)
        if (!providerEnabled(config, provider) || !findExecutable(binary)) return
        const ids = ['default', ...(config[provider]?.accounts ?? []).map((account) => account.id)]
        await Promise.all(
          ids.map(async (id) => {
            const key = `${provider}:${id}`
            let hit = this.emails.get(key)
            if (!hit || Date.now() - hit.at > 10 * 60_000) {
              const state = await signInState(provider, binary, providerEnvironment(provider, config, id)).catch(
                () => undefined,
              )
              hit = { at: Date.now(), ...(state?.email ? { email: state.email } : {}) }
              this.emails.set(key, hit)
            }
            if (hit.email) (result[provider] ??= {})[id] = hit.email
          }),
        )
      }),
    )
    return result
  }

  async signIn(provider: AgentProvider, accountId = 'default'): Promise<void> {
    const adapter = providerAdapter(provider)
    if (!adapter.signIn) throw new Error('Use the Login command for this provider.')
    this.statusCache = undefined
    await adapter.signIn({
      installed: !!findExecutable(providerBinary(provider, this.preferences().providerBinaries)),
      accountId,
      env: providerEnvironment(provider, this.preferences().providerBinaries, accountId),
      acpSignIn,
    })
    this.statusCache = undefined
  }
  /** Shell-free updater, shared by manual actions and the detached service timer. */
  update(provider: AgentProvider): Promise<ProviderStatus> {
    const pending = this.updating.get(provider)
    if (pending) return pending
    const controller = new AbortController()
    const update = async () => {
      const config = this.preferences().providerBinaries
      const plan = providerAdapter(provider).updatePlan({
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
  notices(statuses: ProviderStatus[]) {
    return statuses.filter((s) => s.updateAvailable && !this.dismissed[this.key(s)])
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
  private async readStatus(
    overrides?: ProviderConfiguration,
    checkLatest = false,
    force = true,
  ): Promise<ProviderStatus[]> {
    const config = overrides ?? this.preferences().providerBinaries ?? {}
    const statuses = await Promise.all(
      AGENT_PROVIDERS.map(async (provider): Promise<ProviderStatus> => {
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
        // Never compare a cached release from another release line (see the adapter).
        if (release && providerAdapter(provider).sameReleaseLine?.(version, release.version) === false)
          release = undefined
        if (
          checkLatest &&
          (force || !release || Date.now() - Date.parse(release.checkedAt) > 24 * 60 * 60 * 1000) &&
          (installed || force)
        ) {
          try {
            release = await latestProviderRelease(provider, version)
            this.releases[provider] = release
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
                signIn![accountId] = await signInState(
                  provider,
                  binary,
                  providerEnvironment(provider, config, accountId),
                )
              } catch {
                signIn![accountId] = { signedIn: false }
              }
            }),
          )
        }
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
          binary,
          installed,
          version,
          enabled: providerEnabled(config, provider),
          ...(signIn ? { signIn } : {}),
          accountsSupported: supportsProviderAccounts(provider),
          updating: this.updating.has(provider),
          ...(this.updateErrors.has(provider) ? { updateError: this.updateErrors.get(provider) } : {}),
          latestVersion: release?.version ?? null,
          checkedAt: release?.checkedAt ?? null,
          updateAvailable: !!(installed && version && release && newerVersion(release.version, version)),
          ...(error ? { error } : {}),
          ...(versionError ? { versionError } : {}),
          ...(release?.downloadUrl ? { downloadUrl: release.downloadUrl } : {}),
          ...setup,
        }
      }),
    )
    if (checkLatest && !this.closed) this.write('provider-releases', this.releases)
    return statuses
  }
  close() {
    this.closed = true
    clearTimeout(this.timer)
  }
}
