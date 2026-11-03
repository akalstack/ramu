// Updates Ramu on this host when a person asks from any of their devices. A host with its desktop app open hands the
// install to that app, which applies only a signed, prepared build. A headless host running from a source checkout
// moves to the release tag, installs and builds, and restarts when a service manager will bring it back. Nothing else
// is attempted: the person is told why and where to get the release.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppUpdateStatus } from '@ramu/shared/updates'
import type { HostUpdateResult } from '@ramu/shared/types'

export interface HostUpdateDeps {
  status(): Promise<AppUpdateStatus>
  check(): Promise<AppUpdateStatus>
  download(): Promise<AppUpdateStatus>
  /** True while this host's desktop app is open and can install. */
  desktopAttached(): boolean
  /** Asks the desktop app to install the prepared release; resolves once it accepted and is about to restart. */
  installOnDesktop(version: string): Promise<void>
  /** The repository this server runs from, when it runs from a source checkout. */
  sourceRoot: string | null
  /** Runs one command with an argument array (never a shell string) in `cwd`, failing on a non-zero exit. */
  run(command: string, args: string[], cwd: string): Promise<string>
  /** A service manager restarts this process when it exits. */
  supervised: boolean
}

/** What happened, and whether the caller stops the service once the person's device has the answer. */
export interface HostUpdateRun {
  result: HostUpdateResult
  restartService: boolean
}

/** The checkout this server was built from: three folders above `apps/server/dist`, holding Ramu's own workspace. */
export function sourceCheckout(serverDist: string): string | null {
  const root = join(serverDist, '..', '..', '..')
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string }
    return manifest.name === 'ramu-monorepo' && existsSync(join(root, '.git')) ? root : null
  } catch {
    return null
  }
}

/** One build step: an argument array, never a shell; bounded in time and output; the end of its errors on failure. */
export function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      { cwd, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CI: '1' } },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const tail = `${stderr}`.trim().split('\n').slice(-5).join('\n')
        reject(new Error(`${command} ${args[0] ?? ''} failed${tail ? `: ${tail}` : ''}`))
      },
    ),
  )
}

/** systemd and launchd mark the processes they supervise; `RAMU_SUPERVISED=1` says so for anything else. */
export const isSupervised = (env: NodeJS.ProcessEnv = process.env) =>
  env.RAMU_SUPERVISED === '1' ||
  Boolean(env.INVOCATION_ID) ||
  Boolean(env.XPC_SERVICE_NAME && env.XPC_SERVICE_NAME !== '0')

export class HostUpdater {
  private running = false
  /** A release that failed to install here is not tried again from afar; the person retries on the host. */
  private failed: string | null = null
  constructor(private readonly deps: HostUpdateDeps) {}

  async apply(): Promise<HostUpdateRun> {
    if (this.running) throw new Error('An update is already running on this host.')
    this.running = true
    try {
      let status = await this.deps.status()
      if (!status.release) status = await this.deps.check()
      const release = status.release
      const done = (result: HostUpdateResult, restartService = false): HostUpdateRun => ({ result, restartService })
      if (!release) return done({ outcome: 'current', version: status.currentVersion, message: 'Ramu is up to date.' })
      if (this.failed === release.version)
        return done({
          outcome: 'unavailable',
          version: release.version,
          message: `Ramu ${release.version} did not install on this host last time. Retry it on the host itself.`,
          notesUrl: release.notesUrl,
        })
      if (this.deps.desktopAttached()) return done(await this.onDesktop(status))
      if (this.deps.sourceRoot) {
        const result = await this.fromSource(this.deps.sourceRoot, release.version)
        return done(result, result.outcome === 'restarting')
      }
      return done({
        outcome: 'unavailable',
        version: release.version,
        message: `This host runs Ramu without its desktop app open, so it cannot install ${release.version} itself. Open Ramu there, or install the release from GitHub.`,
        notesUrl: release.notesUrl,
      })
    } finally {
      this.running = false
    }
  }

  private async onDesktop(status: AppUpdateStatus): Promise<HostUpdateResult> {
    const release = status.release!
    if (status.phase !== 'ready') status = await this.deps.download()
    if (status.phase !== 'ready')
      throw new Error(status.error ?? `Ramu ${release.version} could not be downloaded on this host.`)
    await this.deps.installOnDesktop(release.version)
    return {
      outcome: 'restarting',
      version: release.version,
      message: `Ramu ${release.version} is installing. The host restarts and reconnects.`,
    }
  }

  private async fromSource(root: string, version: string): Promise<HostUpdateResult> {
    const run = (command: string, ...args: string[]) => this.deps.run(command, args, root)
    if ((await run('git', 'status', '--porcelain', '--untracked-files=no')).trim())
      return {
        outcome: 'unavailable',
        version,
        message: `This host's Ramu checkout has local changes, so it is left as it is. Commit or discard them, then update.`,
      }
    const previous = (await run('git', 'rev-parse', 'HEAD')).trim()
    const tag = `v${version}`
    try {
      await run('git', 'fetch', '--tags', '--quiet', 'origin', `refs/tags/${tag}:refs/tags/${tag}`)
      await run('git', 'checkout', '--quiet', '--detach', tag)
      await run('pnpm', 'install', '--frozen-lockfile')
      await run('pnpm', 'build')
    } catch (error) {
      this.failed = version
      // Put the checkout and its build back as they were, so the next restart still starts the version that ran.
      await run('git', 'checkout', '--quiet', '--detach', previous).catch(() => {})
      await run('pnpm', 'install', '--frozen-lockfile').catch(() => {})
      await run('pnpm', 'build').catch(() => {})
      throw new Error(
        `Ramu ${version} did not build on this host, so it keeps the version it runs: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    if (!this.deps.supervised)
      return {
        outcome: 'built',
        version,
        message: `Ramu ${version} is built. Restart Ramu's service on this host to start it; no service manager restarts it here.`,
      }
    return {
      outcome: 'restarting',
      version,
      message: `Ramu ${version} is built. The host restarts and reconnects.`,
    }
  }
}
