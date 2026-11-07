// A platform's own browser sign-in, run on the host as an argument list. The person sees the link (and code) on the
// device they are using and authorizes there; Ramu then reads the token the CLI saved, checks it and moves it into
// the credential store. Each sign-in runs against a fresh, private CLI configuration folder that is deleted
// afterwards, so the person's own CLI login is never read, changed or signed out.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliSignInPlatform, HostingSignIn } from '@ramu/shared/types/deploy'
import { findExecutable } from '../../providers/providerBinaries'
import type { HostingAccounts, HostingSecret } from './accounts'

const TIMEOUT_MS = 10 * 60_000
const POLL_MS = 4_000

/** Packaged apps may start without the shell's PATH, so look in the usual install locations too. */
export function platformCli(name: string): string | null {
  return (
    findExecutable(name) ??
    ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
      .map((dir) => join(dir, name))
      .find((path) => existsSync(path)) ??
    null
  )
}

/** Only what a CLI needs to run: no agent markers (which switch CLIs to agent output), no Ramu secrets. */
export function cliEnvironment(home: string): NodeJS.ProcessEnv {
  const keep = ['PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SystemRoot']
  return {
    ...Object.fromEntries(keep.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))),
    HOME: home,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
}

/** The first https link in CLI output, and a device code when the CLI prints one. */
export function signInPrompt(output: string): { url: string | null; code: string | null } {
  // eslint-disable-next-line no-control-regex -- strips terminal colour and hyperlink escapes from CLI output
  const plain = output.replace(/\u001b\][^\u0007]*\u0007|\u001b\[[0-9;]*[A-Za-z]/g, '')
  // A terminal hyperlink carries the full link (with its code) while the visible text may be shortened.
  // eslint-disable-next-line no-control-regex -- the OSC 8 hyperlink escape
  const linked = output.match(/\u001b\]8;;(https:\/\/[^\u0007\u001b]+)/)?.[1]
  const url = linked ?? plain.match(/https:\/\/[^\s"'<>]+/)?.[0] ?? null
  const code =
    (url ? new URL(url).searchParams.get('user_code') : null) ??
    plain.match(/enter (?:the code )?([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1] ??
    plain.match(/enter this code:\s*([A-Za-z0-9-]{4,32})/i)?.[1] ??
    null
  return { url, code }
}

/** Vercel's CLI saves its login as `auth.json` in the configuration folder it was given with `--global-config`. */
export async function vercelCliToken(configDir: string): Promise<HostingSecret> {
  const file = join(configDir, 'auth.json')
  if (!existsSync(file)) {
    // A login bound to a device key is saved apart and cannot be used without that key.
    if (existsSync(join(configDir, 'credentials.json')))
      throw new Error(
        'This Vercel CLI signed in with a key bound to this computer, which Ramu cannot use. Use a token instead.',
      )
    throw new Error('The Vercel CLI finished without saving a sign-in.')
  }
  const saved = JSON.parse(await readFile(file, 'utf8')) as {
    token?: string
    refreshToken?: string
    expiresAt?: number
  }
  if (!saved.token) throw new Error('The Vercel CLI finished without saving a sign-in.')
  return {
    token: saved.token,
    ...(saved.refreshToken ? { refreshToken: saved.refreshToken } : {}),
    // The CLI writes seconds.
    ...(saved.expiresAt ? { expiresAt: saved.expiresAt * 1000 } : {}),
  }
}

/**
 * Netlify's CLI keeps its login in `config.json` under its configuration folder: `~/Library/Preferences/netlify` on
 * macOS, `$XDG_CONFIG_HOME/netlify` or `~/.config/netlify` on Linux, `~/.netlify` for old versions.
 */
export async function netlifyCliToken(home: string): Promise<HostingSecret> {
  const candidates = [
    join(home, 'Library', 'Preferences', 'netlify', 'config.json'),
    join(home, '.config', 'netlify', 'config.json'),
    join(home, '.netlify', 'config.json'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const config = JSON.parse(await readFile(file, 'utf8')) as {
      userId?: string
      users?: Record<string, { auth?: { token?: string } }>
    }
    const token = config.userId ? config.users?.[config.userId]?.auth?.token : undefined
    if (token) return { token }
  }
  throw new Error('The Netlify CLI finished without saving a sign-in.')
}

/**
 * Railway's CLI keeps its OAuth session in `~/.railway/config.json`: an access token, the refresh token that renews it
 * and when it expires (seconds). Older versions kept a plain token there instead.
 */
export async function railwayCliToken(home: string): Promise<HostingSecret> {
  const file = join(home, '.railway', 'config.json')
  if (!existsSync(file)) throw new Error('The Railway CLI finished without saving a sign-in.')
  const { user } = JSON.parse(await readFile(file, 'utf8')) as {
    user?: { token?: string; accessToken?: string; refreshToken?: string; tokenExpiresAt?: number }
  }
  if (user?.accessToken)
    return {
      token: user.accessToken,
      ...(user.refreshToken ? { refreshToken: user.refreshToken } : {}),
      ...(user.tokenExpiresAt ? { expiresAt: user.tokenExpiresAt * 1000 } : {}),
    }
  if (user?.token) return { token: user.token }
  throw new Error('The Railway CLI finished without saving a sign-in.')
}

/**
 * flyctl keeps its login as `access_token` in `~/.fly/config.yml`: a user token, macaroons, or both, comma-separated.
 * It has no expiry Ramu can renew; a revoked one shows as signed out.
 */
export async function flyCliToken(home: string): Promise<HostingSecret> {
  const file = join(home, '.fly', 'config.yml')
  if (!existsSync(file)) throw new Error('The Fly.io CLI finished without saving a sign-in.')
  const line = /^access_token:\s*(.+)$/m.exec(await readFile(file, 'utf8'))?.[1]?.trim()
  const token = line?.replace(/^(["'])(.*)\1$/, '$2').trim()
  if (!token) throw new Error('The Fly.io CLI finished without saving a sign-in.')
  return { token }
}

interface Running {
  view: HostingSignIn
  children: Set<ChildProcess>
  stopped: boolean
  folder: string | null
}

type Spawn = typeof spawn

export class HostingSignIns {
  private readonly running = new Map<string, Running>()

  constructor(
    private readonly accounts: HostingAccounts,
    private readonly cli: (platform: CliSignInPlatform) => string | null = platformCli,
    private readonly spawner: Spawn = spawn,
    private readonly pollMs = POLL_MS,
  ) {}

  start(platform: CliSignInPlatform): HostingSignIn {
    const executable = this.cli(platform)
    if (!executable) throw new Error(`The ${platform} CLI is not installed on this host. Use a token instead.`)
    // One sign-in per platform at a time; a new one replaces the old.
    for (const [id, entry] of this.running) if (entry.view.platform === platform) this.cancel(id)
    const entry: Running = {
      view: { id: randomUUID(), platform, state: 'starting', url: null, code: null, account: null, error: null },
      children: new Set(),
      stopped: false,
      folder: null,
    }
    this.running.set(entry.view.id, entry)
    const timer = setTimeout(() => this.fail(entry, 'The sign-in timed out. Start it again.'), TIMEOUT_MS)
    timer.unref()
    void (async () => {
      try {
        entry.folder = await mkdtemp(join(tmpdir(), `ramu-${platform}-`))
        const secret =
          platform === 'vercel'
            ? await this.vercel(entry, executable, entry.folder)
            : platform === 'netlify'
              ? await this.netlify(entry, executable, entry.folder)
              : platform === 'railway'
                ? await this.railway(entry, executable, entry.folder)
                : await this.fly(entry, executable, entry.folder)
        if (entry.stopped) return
        const account = await this.accounts.save(platform, secret, 'cli')
        entry.view = { ...entry.view, state: 'connected', account: account.account, error: null }
      } catch (error) {
        this.fail(entry, error instanceof Error ? error.message : String(error))
      } finally {
        clearTimeout(timer)
        if (entry.folder) await rm(entry.folder, { recursive: true, force: true }).catch(() => {})
        // Kept briefly so the client's next poll reads the result.
        setTimeout(() => this.running.delete(entry.view.id), 60_000).unref()
      }
    })()
    return entry.view
  }

  status(id: string): HostingSignIn {
    const entry = this.running.get(id)
    if (!entry) throw new Error('That sign-in is no longer running. Start it again.')
    return entry.view
  }

  cancel(id: string): void {
    const entry = this.running.get(id)
    if (!entry) return
    this.fail(entry, 'Cancelled.')
  }

  private fail(entry: Running, message: string) {
    if (entry.view.state === 'connected' || entry.view.state === 'failed') return
    entry.stopped = true
    for (const child of entry.children) child.kill()
    entry.view = { ...entry.view, state: 'failed', error: message }
  }

  /** Runs one CLI command; `onOutput` sees everything printed so far. Resolves with stdout on exit 0. */
  private run(
    entry: Running,
    executable: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    onOutput?: (text: string) => void,
  ) {
    return new Promise<string>((resolve, reject) => {
      if (entry.stopped) return reject(new Error('Cancelled.'))
      const child = this.spawner(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
      entry.children.add(child)
      let stdout = ''
      let all = ''
      const take = (chunk: Buffer, out: boolean) => {
        const text = chunk.toString('utf8')
        if (out) stdout += text
        all = (all + text).slice(-20_000)
        onOutput?.(all)
      }
      child.stdout?.on('data', (chunk: Buffer) => take(chunk, true))
      child.stderr?.on('data', (chunk: Buffer) => take(chunk, false))
      child.on('error', (error) => {
        entry.children.delete(child)
        reject(error)
      })
      child.on('close', (code) => {
        entry.children.delete(child)
        if (entry.stopped) reject(new Error('Cancelled.'))
        else if (code === 0) resolve(stdout)
        else reject(new Error(`The ${entry.view.platform} sign-in did not finish.`))
      })
    })
  }

  private show(entry: Running, output: string) {
    const prompt = signInPrompt(output)
    // The code can be printed after the link, in a later chunk.
    if (prompt.url && (!entry.view.url || (!entry.view.code && prompt.code)))
      entry.view = { ...entry.view, state: 'waiting', ...prompt }
  }

  /**
   * `railway login --browserless` runs Railway's device sign-in: it prints a link (with its code) that works from any
   * device and waits for approval, then saves the session in the private HOME.
   */
  private async railway(entry: Running, executable: string, folder: string): Promise<HostingSecret> {
    await this.run(entry, executable, ['login', '--browserless'], cliEnvironment(folder), (output) =>
      this.show(entry, output),
    )
    return railwayCliToken(folder)
  }

  /**
   * `fly auth login` opens Fly.io's sign-in in the host's browser and prints its link; the page hands the token back to
   * flyctl on a loopback port, which saves it in the private HOME's `.fly` folder.
   */
  private async fly(entry: Running, executable: string, folder: string): Promise<HostingSecret> {
    await this.run(entry, executable, ['auth', 'login'], cliEnvironment(folder), (output) => this.show(entry, output))
    return flyCliToken(folder)
  }

  /** `vercel login` runs Vercel's device sign-in and prints the link with its code, then waits for approval. */
  private async vercel(entry: Running, executable: string, folder: string): Promise<HostingSecret> {
    const config = join(folder, 'vercel')
    await mkdir(config, { recursive: true })
    // The real HOME stays, since the CLI keeps its own binary cache there; only its configuration is private.
    const env = { ...cliEnvironment(process.env.HOME ?? folder), VERCEL_TOKEN_STORAGE: 'file' }
    await this.run(entry, executable, ['login', '--global-config', config], env, (output) => this.show(entry, output))
    return vercelCliToken(config)
  }

  /**
   * `netlify login --request` creates a ticket and prints its link without opening a browser on the host; Ramu checks
   * the ticket until the person authorizes it, and the CLI then saves the token in the private HOME.
   */
  private async netlify(entry: Running, executable: string, folder: string): Promise<HostingSecret> {
    const env = cliEnvironment(folder)
    const ticket = JSON.parse(await this.run(entry, executable, ['login', '--request', 'Ramu', '--json'], env)) as {
      ticket_id?: string
      url?: string
    }
    if (!ticket.ticket_id || !ticket.url) throw new Error('The Netlify CLI did not start a sign-in.')
    entry.view = { ...entry.view, state: 'waiting', url: ticket.url, code: null }
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
      if (entry.stopped) throw new Error('Cancelled.')
      const check = JSON.parse(
        await this.run(entry, executable, ['login', '--check', ticket.ticket_id, '--json'], env),
      ) as { status?: string }
      if (check.status === 'authorized') return netlifyCliToken(folder)
      if (check.status === 'denied') throw new Error('Netlify declined the sign-in.')
    }
  }
}
