import type { ActivityService } from './activity'
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_PROVIDERS, providerEnabled, supportsProviderAccounts, type ProviderConfiguration, type ProviderSignIn, type ProviderStatus } from '@ramu/shared/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { acpSignIn } from './acp'
import { configureProviderBinaries, findExecutable, prepareProviderAccount, providerAccountClearedEnv, providerAccountEnv, providerAccountHome, providerRuntimeHome, providerBinary, providerEnvironment } from './providerBinaries'

type Release = { version: string; checkedAt: string; downloadUrl?: string }
type Cache = Partial<Record<AgentProvider, Release>>
export const parseProviderVersion = (output: string): string | null => output.match(/\b\d{4}\.\d{2}\.\d{2}-[a-z0-9]+\b/i)?.[0] ?? output.match(/\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1] ?? null
import { newerVersion } from '@ramu/shared/version'
import { installAntigravity } from './antigravityInstall'
export { newerVersion }
export function providerSetup(provider: AgentProvider, version: string | null): Pick<ProviderStatus, 'docsUrl' | 'installCommand' | 'updateCommand' | 'setupCommand' | 'setupNote'> {
  const windows = process.platform === 'win32'
  switch (provider) {
    case 'claude-code': return { docsUrl: 'https://code.claude.com/docs/en/setup', installCommand: windows ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash', updateCommand: 'claude update', setupCommand: 'claude', setupNote: 'Install Claude Code and run it in a terminal to sign in. Ramu uses your installed CLI through the Claude Agent SDK; select its executable path if automatic detection does not find it.' }
    case 'codex': return { docsUrl: 'https://developers.openai.com/codex/cli/', installCommand: 'npm install -g @openai/codex@latest', updateCommand: 'npm install -g @openai/codex@latest', setupCommand: 'codex login', setupNote: 'Install with npm, then sign in with your ChatGPT account or configure your API key.' }
    case 'cursor': return { docsUrl: 'https://cursor.com/docs/cli/installation', installCommand: windows ? "irm 'https://cursor.com/install?win32=true' | iex" : 'curl https://cursor.com/install -fsS | bash', updateCommand: 'agent update', setupCommand: 'agent login', setupNote: 'Install the Cursor CLI and sign in. Ramu connects through its ACP mode.' }
    case 'opencode': {
      const v1 = version?.startsWith('1.')
      return { docsUrl: v1 ? 'https://opencode.ai/docs/' : 'https://opencode.ai/v2/docs/', installCommand: windows ? null : `curl -fsSL https://opencode.ai/${v1 ? '' : 'v2/'}install | bash`, updateCommand: windows ? null : `curl -fsSL https://opencode.ai/${v1 ? '' : 'v2/'}install | bash`, setupCommand: 'opencode', setupNote: 'Open OpenCode in a terminal and use /connect to configure model providers. Version checks stay on your installed major version. On Windows, download the standalone CLI from the setup guide.' }
    }
    case 'antigravity': return { docsUrl: 'https://antigravity.google/docs/ide/extensions', installCommand: null, updateCommand: null, setupCommand: null, setupNote: 'Ramu downloads Google\'s official ACP runtime for you: choose Install runtime, then Login (opens Google sign-in in your browser). To use your own copy, select agy_acp_server.par (or .exe) and its localharness_external helper under Advanced. The Antigravity IDE is a separate application.' }
  }
}
async function officialText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Ramu-provider-updates', Accept: 'application/json, text/plain' } })
  if (!response.ok) throw new Error(`Release source returned HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('Release response too large')
  return text
}
export async function latestProviderRelease(provider: AgentProvider, current: string | null): Promise<Release> {
  let version: string | undefined, downloadUrl: string | undefined
  if (provider === 'cursor') {
    const script = await officialText(`https://cursor.com/install${process.platform === 'win32' ? '?win32=true' : ''}`)
    version = /downloads\.cursor\.com\/lab\/([^/"\s]+)/.exec(script)?.[1]
  } else if (provider === 'antigravity') {
    const registry = JSON.parse(await officialText('https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json'))
    version = registry.version
    const target = `${process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch}`
    const archive = registry.distribution?.binary?.[target]?.archive
    if (typeof archive === 'string' && new URL(archive).origin === 'https://dl.google.com') downloadUrl = archive
  } else {
    const pkg = provider === 'codex' ? '@openai/codex' : provider === 'claude-code' ? '@anthropic-ai/claude-code' : current?.startsWith('1.') ? 'opencode-ai' : '@opencode/cli'
    version = JSON.parse(await officialText(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`)).version
  }
  if (!version || !parseProviderVersion(version)) throw new Error('Release source did not provide a recognizable version')
  return { version, checkedAt: new Date().toISOString(), ...(downloadUrl ? { downloadUrl } : {}) }
}
async function installedVersion(provider: AgentProvider, binary: string, config: ProviderConfiguration): Promise<string | null> {
  if (provider !== 'antigravity') return new Promise((resolve, reject) => {
    execFile(binary, ['--version'], { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, env: providerEnvironment(provider, config) }, (error, stdout) => error ? reject(new Error('The binary could not report its version. Check its path and permissions.')) : resolve(parseProviderVersion(stdout)))
  })
  // ACP initialize reports the runtime version without starting a chat or authenticating.
  return new Promise((resolve, reject) => {
    const child = spawn(binary, process.platform === 'linux' ? ['--uid='] : [], { cwd: homedir(), env: providerEnvironment(provider, config), stdio: 'pipe', windowsHide: true })
    child.stderr.resume(); child.stdin.on('error', () => {})
    const lines = createInterface({ input: child.stdout })
    let settled = false
    const finish = (value: string | null, error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); lines.close(); child.kill(); const kill = setTimeout(() => child.kill('SIGKILL'), 1000); kill.unref(); child.once('exit', () => clearTimeout(kill)); error ? reject(error) : resolve(value) }
    const timer = setTimeout(() => finish(null, new Error('ACP runtime did not report its version. Check the helper path.')), 5000)
    child.once('error', () => finish(null, new Error('Cannot start the ACP runtime.')))
    child.once('exit', () => finish(null, new Error('ACP runtime stopped before reporting its version.')))
    lines.on('line', (line) => { try { const message = JSON.parse(line); if (message.id === 1) finish(parseProviderVersion(message.result?.agentInfo?.version ?? '')) } catch {} })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientInfo: { name: 'ramu', version: '0.0.1' }, clientCapabilities: {} } }) + '\n')
  })
}

const run = (binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; out: string }> => new Promise((resolve) => {
  execFile(binary, args, { timeout: 8000, maxBuffer: 64 * 1024, windowsHide: true, env }, (error, stdout, stderr) => resolve({ ok: !error, out: `${stdout}${stderr}` }))
})
/** Asks the CLI itself whether it holds a login, without starting a chat. Details are shown only to the user who owns the login. */
export async function signInState(provider: AgentProvider, binary: string, env: NodeJS.ProcessEnv): Promise<ProviderSignIn> {
  if (provider === 'antigravity') {
    try { const type = JSON.parse(readFileSync(join(env.GEMINI_HOME || join(homedir(), '.gemini'), 'antigravity-acp', 'settings.json'), 'utf8'))?.auth?.type; return typeof type === 'string' && type ? { signedIn: true, detail: type } : { signedIn: false } } catch { return { signedIn: false } }
  }
  if (provider === 'claude-code') {
    const { out } = await run(binary, ['auth', 'status'], env)
    try { const status = JSON.parse(out); return status.loggedIn ? { signedIn: true, ...(typeof status.authMethod === 'string' ? { detail: status.authMethod } : {}) } : { signedIn: false } } catch { return { signedIn: false } }
  }
  if (provider === 'codex') {
    const { ok, out } = await run(binary, ['login', 'status'], env)
    return ok && /logged in/i.test(out) ? { signedIn: true, detail: out.trim().split('\n')[0]!.replace(/^logged in( using)?\s*/i, '') || undefined } : { signedIn: false }
  }
  if (provider === 'cursor') {
    const { out } = await run(binary, ['status'], env)
    const match = /logged in(?: as (\S+))?/i.exec(out)
    return match && !/not logged in/i.test(out) ? { signedIn: true, ...(match[1] ? { detail: match[1] } : {}) } : { signedIn: false }
  }
  const { out } = await run(binary, ['auth', 'list'], env)
  const stored = out.split('\n').filter((line) => /\b(stored|env)\b/i.test(line)).length
  return stored ? { signedIn: true, detail: String(stored) } : { signedIn: false }
}

export class ProviderService {
  private timer: NodeJS.Timeout | undefined
  private closed = false
  private automaticRunning = false
  private generation = 0
  private releases: Cache
  private dismissed: Record<string, boolean>
  private updating = new Map<AgentProvider, Promise<ProviderStatus>>()
  private updateErrors = new Map<AgentProvider, string>()
  constructor(private preferences: () => Pick<AppPreferences, 'providerBinaries' | 'providerUpdateChecks'>, private read: <T>(key: string, fallback: T) => T, private write: (key: string, value: unknown) => void, private emit: (statuses: ProviderStatus[]) => void, private activity?: ActivityService) {
    this.releases = read<Cache>('provider-releases', {})
    this.dismissed = read<Record<string, boolean>>('provider-updates-dismissed', {})
    this.settingsChanged()
  }
  settingsChanged() {
    configureProviderBinaries(this.preferences().providerBinaries ?? {})
    this.generation++; clearTimeout(this.timer)
    if (this.shouldCheck() && !this.closed) { this.timer = setTimeout(() => void this.automatic(), 30_000); this.timer.unref() }
    else this.emit([])
  }
  private async automatic() {
    if (this.closed || !this.shouldCheck()) return
    if (!this.automaticRunning) {
      this.automaticRunning = true
      const generation = this.generation
      try {
        let statuses = await this.status(undefined, true, false)
        if (!this.closed && generation === this.generation) {
          for (const status of statuses) if (status.updateAvailable && this.preferences().providerBinaries[status.provider]?.autoUpdate) await this.update(status.provider).catch(() => {})
          if (statuses.some((status) => this.preferences().providerBinaries[status.provider]?.autoUpdate)) statuses = await this.status()
          if (!this.closed && generation === this.generation && this.preferences().providerUpdateChecks) this.emit(this.notices(statuses))
        }
      } catch {} finally { this.automaticRunning = false }
    }
    if (!this.closed && this.shouldCheck()) { clearTimeout(this.timer); this.timer = setTimeout(() => void this.automatic(), 6 * 60 * 60 * 1000); this.timer.unref() }
  }
  private shouldCheck() { return this.preferences().providerUpdateChecks || Object.values(this.preferences().providerBinaries).some((config) => config?.autoUpdate) }
  loginCommand(provider: AgentProvider, config = this.preferences().providerBinaries): string | null {
    const args = provider === 'claude-code' ? ['auth', 'login'] : provider === 'codex' || provider === 'cursor' ? ['login'] : provider === 'opencode' ? ['auth', 'login'] : null
    if (!args) return null
    const id = config[provider]?.accountId || 'default'
    const env = providerEnvironment(provider, config, id)
    if (id !== 'default') {
      const root = providerAccountHome(provider, id)
      prepareProviderAccount(provider, root)
    }
    const quote = (value: string) => `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\"'\"'")}'`
    const keys = Object.keys(providerAccountEnv(provider, providerAccountHome(provider, id === 'default' ? 'x' : id)))
    const assignments = id === 'default' ? '' : keys.map((key) => process.platform === 'win32' ? `$env:${key}=${quote(env[key]!)}; ` : `${key}=${quote(env[key]!)}`).join(process.platform === 'win32' ? '' : ' ') + ' '
    const cleared = providerAccountClearedEnv(provider)
    const clean = id === 'default' || !cleared.length ? '' : process.platform === 'win32' ? `Remove-Item ${cleared.map((key) => `Env:${key}`).join(',')} -ErrorAction SilentlyContinue; ` : `env ${cleared.map((key) => `-u ${key}`).join(' ')} `
    return `${clean}${assignments}${process.platform === 'win32' ? '& ' : ''}${quote(providerBinary(provider, config))} ${args.join(' ')}`
  }
  /** Providers whose sign-in runs inside Ramu instead of a terminal command. */
  async signIn(provider: AgentProvider, accountId = 'default'): Promise<void> {
    if (provider !== 'antigravity') throw new Error('Use the Login command for this provider.')
    if (!findExecutable(providerBinary(provider, this.preferences().providerBinaries))) throw new Error('Select the Antigravity ACP runtime first.')
    await acpSignIn('antigravity', 'oauth-personal', accountId)
  }
  /** Shell-free updater, shared by manual actions and the detached service timer. */
  update(provider: AgentProvider): Promise<ProviderStatus> {
    const pending = this.updating.get(provider)
    if (pending) return pending
    const update = async () => {
      const config = this.preferences().providerBinaries
      if (provider === 'antigravity') {
        // Ramu downloads Google's official runtime itself; a runtime the user picked by path or env keeps its own updater.
        if (config.antigravity?.binary?.trim() || process.env.RAMU_ANTIGRAVITY_BIN) throw new Error('Update this custom Antigravity runtime yourself, or clear its path to let Ramu manage it.')
        this.updateErrors.delete(provider)
        await installAntigravity()
        return (await this.status()).find((status) => status.provider === provider)!
      }
      const binary = providerBinary(provider, config)
      if (!findExecutable(binary)) throw new Error('Select an installed CLI before updating it.')
      if (provider === 'codex' && (config.codex?.binary?.trim() || process.env.RAMU_CODEX_BIN)) throw new Error('Update this custom Codex installation with its package manager.')
      const command = provider === 'codex' ? (findExecutable(process.platform === 'win32' ? 'npm.cmd' : 'npm') ?? 'npm') : binary
      // Own the npm-managed replacement instead of modifying an unrelated global
      // installation selected by npm's prefix. Existing native processes keep running.
      const args = provider === 'codex' ? ['install', '--prefix', providerRuntimeHome(provider), '--no-audit', '--no-fund', '@openai/codex@latest'] : provider === 'opencode' ? ['upgrade'] : ['update']
      this.updateErrors.delete(provider)
      await new Promise<void>((resolve, reject) => execFile(command, args, { timeout: 5 * 60_000, maxBuffer: 1024 * 1024, windowsHide: true, env: providerEnvironment(provider, config) }, (error) => error ? reject(new Error('CLI update failed. Check permissions, network access, and how this CLI was installed.')) : resolve()))
      return (await this.status()).find((status) => status.provider === provider)!
    }
    const work = (this.activity ? this.activity.run('Updating CLI', provider, update) : update()).catch((error) => { this.updateErrors.set(provider, (error as Error).message); throw error }).finally(() => this.updating.delete(provider))
    this.updating.set(provider, work)
    return work
  }
  private key(s: ProviderStatus) { return `${s.provider}:${s.binary}:${s.latestVersion}` }
  notices(statuses: ProviderStatus[]) { return statuses.filter((s) => s.updateAvailable && !this.dismissed[this.key(s)]) }
  dismiss(status: ProviderStatus) { this.dismissed[this.key(status)] = true; this.write('provider-updates-dismissed', this.dismissed) }
  async updates() { return this.preferences().providerUpdateChecks ? this.notices(await this.status()) : [] }
  status(overrides?: ProviderConfiguration, checkLatest = false, force = true): Promise<ProviderStatus[]> {
    const work = () => this.readStatus(overrides, checkLatest, force)
    return checkLatest && this.activity ? this.activity.run('Checking CLI updates', undefined, work) : work()
  }
  private async readStatus(overrides?: ProviderConfiguration, checkLatest = false, force = true): Promise<ProviderStatus[]> {
    const config = overrides ?? this.preferences().providerBinaries ?? {}
    const statuses = await Promise.all(AGENT_PROVIDERS.map(async (provider): Promise<ProviderStatus> => {
      const binary = providerBinary(provider, config), installed = !!findExecutable(binary)
      let version: string | null = null, error: string | undefined, versionError: string | undefined
      if (installed) { try { version = await installedVersion(provider, binary, config); if (!version) versionError = 'The binary did not report a recognizable version.' } catch (reason) { versionError = String((reason as Error).message) } }
      let release = this.releases[provider]
      // OpenCode publishes v1 and v2 separately. Never compare a cached release from another line.
      if (provider === 'opencode' && release && (version?.startsWith('1.') ?? false) !== release.version.startsWith('1.')) release = undefined
      if (checkLatest && (force || !release || Date.now() - Date.parse(release.checkedAt) > 24 * 60 * 60 * 1000) && (installed || force)) {
        try { release = await latestProviderRelease(provider, version); this.releases[provider] = release } catch (reason) { error = `Latest version check failed: ${(reason as Error).message}` }
      }
      let signIn: Record<string, ProviderSignIn> | undefined
      if (force && installed) {
        signIn = {}
        const ids = ['default', ...(supportsProviderAccounts(provider) ? (config[provider]?.accounts ?? []).map((account) => account.id) : [])]
        await Promise.all(ids.map(async (accountId) => { try { signIn![accountId] = await signInState(provider, binary, providerEnvironment(provider, config, accountId)) } catch { signIn![accountId] = { signedIn: false } } }))
      }
      const setup = providerSetup(provider, version)
      const quoted = process.platform === 'win32' ? `& '${binary.replaceAll("'", "''")}'` : `'${binary.replaceAll("'", "'\"'\"'")}'`
      const useBinary = (command: string | null) => command?.replace(/^(claude|codex|agent|opencode)(?= |$)/, () => quoted) ?? null
      setup.setupCommand = useBinary(setup.setupCommand)
      setup.updateCommand = useBinary(setup.updateCommand)
      return { provider, binary, installed, version, enabled: providerEnabled(config, provider), ...(signIn ? { signIn } : {}), accountsSupported: supportsProviderAccounts(provider), updating: this.updating.has(provider), ...(this.updateErrors.has(provider) ? { updateError: this.updateErrors.get(provider) } : {}), latestVersion: release?.version ?? null, checkedAt: release?.checkedAt ?? null, updateAvailable: !!(installed && version && release && newerVersion(release.version, version)), ...(error ? { error } : {}), ...(versionError ? { versionError } : {}), ...(release?.downloadUrl ? { downloadUrl: release.downloadUrl } : {}), ...setup }
    }))
    if (checkLatest && !this.closed) this.write('provider-releases', this.releases)
    return statuses
  }
  close() { this.closed = true; clearTimeout(this.timer) }
}
