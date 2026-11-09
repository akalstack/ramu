// A platform's own browser sign-in, run on the host as an argument list. The person sees the link (and code) on the
// device they are using and authorizes there; Ramu then reads the token the CLI saved, checks it and moves it into
// the credential store. Each sign-in runs against a fresh, private CLI configuration folder that is deleted
// afterwards, so the person's own CLI login is never read, changed or signed out.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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

/** The CLI a platform's sign-in runs: its own, or for Expo the `eas` CLI, else the published one through npx. */
export function signInCli(platform: CliSignInPlatform): string | null {
  if (platform === 'expo') return platformCli('eas') ?? platformCli('npx')
  if (platform === 'neon') return platformCli('neon') ?? platformCli('neonctl') ?? platformCli('npx')
  return platformCli(platform)
}

/** The API key `neon profile create --mint` saved for a profile in its configuration folder. */
export async function neonCliKey(configDir: string, profile: string): Promise<HostingSecret> {
  const file = join(configDir, `credentials.${profile}.json`)
  const saved = JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as { type?: unknown; api_key?: unknown }
  if (saved.type !== 'api_key' || typeof saved.api_key !== 'string' || !saved.api_key)
    throw new Error('The Neon CLI finished without saving a key.')
  return { token: saved.api_key }
}

const EXPO_API = 'https://api.expo.dev'

/**
 * Turns the session `eas login` saved into an access token named Ramu, then ends the session, so only the token,
 * which can be revoked on expo.dev, stays.
 */
export async function expoSessionToken(
  session: string,
  fetcher: typeof fetch = fetch,
  api = EXPO_API,
): Promise<HostingSecret> {
  const headers = { 'content-type': 'application/json', 'expo-session': session }
  const graphql = async <T>(query: string, variables: Record<string, unknown> = {}) => {
    const response = await fetcher(`${api}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    })
    const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: unknown[] }
    if (!response.ok || body.errors?.length || !body.data)
      throw new Error('Expo did not accept the sign-in. Start it again.')
    return body.data
  }
  try {
    const { meActor } = await graphql<{ meActor: { id: string } | null }>('{ meActor { id } }')
    if (!meActor) throw new Error('Expo did not accept the sign-in. Start it again.')
    const created = await graphql<{ accessToken: { createAccessToken: { token: string } } }>(
      'mutation ($data: CreateAccessTokenInput!) { accessToken { createAccessToken(createAccessTokenData: $data) { token } } }',
      { data: { actorID: meActor.id, note: 'Ramu' } },
    )
    return { token: created.accessToken.createAccessToken.token }
  } finally {
    await fetcher(`${api}/v2/auth/logout`, { method: 'POST', headers, body: '{}' }).catch(() => {})
  }
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

interface Running {
  view: HostingSignIn
  children: Set<ChildProcess>
  stopped: boolean
  folder: string | null
  /** The number the person picked on the platform's page, for a sign-in that asks for one. */
  match?: string
}

type Spawn = typeof spawn

export class HostingSignIns {
  private readonly running = new Map<string, Running>()

  constructor(
    private readonly accounts: HostingAccounts,
    private readonly cli: (platform: CliSignInPlatform) => string | null = signInCli,
    private readonly spawner: Spawn = spawn,
    private readonly pollMs = POLL_MS,
    private readonly expoToken: (session: string) => Promise<HostingSecret> = expoSessionToken,
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
              : platform === 'expo'
                ? await this.expo(entry, executable, entry.folder)
                : await this.neon(entry, executable, entry.folder)
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

  /** The number the person picked on the platform's page; the next check sends it. */
  match(id: string, number: string): HostingSignIn {
    const entry = this.running.get(id)
    if (!entry || entry.view.state !== 'waiting') throw new Error('That sign-in is no longer waiting. Start it again.')
    entry.match = number
    entry.view = { ...entry.view, asksNumber: false }
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

  /**
   * `eas login --device --non-interactive` starts Expo's device sign-in, whose link works from any device, and exits
   * with a request id. Ramu then resumes it until the person approves; when Expo's page shows a number to pick, the
   * person sends it back and the next resume passes it with `--match`. The session lands in the private HOME and is
   * exchanged for an access token named Ramu.
   */
  private async expo(entry: Running, executable: string, folder: string): Promise<HostingSecret> {
    const prefix = basename(executable).startsWith('npx') ? ['--yes', 'eas-cli@latest'] : []
    // npm's cache stays the person's own, so npx does not fetch eas again; the Expo session goes to the private HOME.
    const env = { ...cliEnvironment(folder), npm_config_cache: join(process.env.HOME ?? folder, '.npm') }
    const login = [...prefix, 'login', '--device', '--non-interactive']
    const started = await this.run(entry, executable, login, env)
    const request = /--resume ([0-9a-f-]{36})/.exec(started)?.[1]
    this.show(entry, started)
    if (!request || !entry.view.url) throw new Error('EAS did not start a sign-in.')
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
      if (entry.stopped) throw new Error('Cancelled.')
      const out = await this.run(
        entry,
        executable,
        [...login, '--resume', request, ...(entry.match ? ['--match', entry.match] : [])],
        env,
      )
      if (/Logged in as/.test(out)) break
      if (/number shown in their browser/.test(out) && !entry.match) entry.view = { ...entry.view, asksNumber: true }
    }
    const state = JSON.parse(await readFile(join(folder, '.expo', 'state.json'), 'utf8').catch(() => '{}')) as {
      auth?: { sessionSecret?: unknown }
    }
    const session = state.auth?.sessionSecret
    if (typeof session !== 'string' || !session) throw new Error('EAS finished without saving a sign-in.')
    return this.expoToken(session)
  }

  /**
   * `neon profile create ramu --mint` opens Neon's sign-in in the host's browser and prints its link; once the person
   * approves, the CLI mints an API key, saves only that in the private configuration folder and drops the session.
   */
  private async neon(entry: Running, executable: string, folder: string): Promise<HostingSecret> {
    const prefix = basename(executable).startsWith('npx') ? ['--yes', 'neonctl@latest'] : []
    const config = join(folder, 'neon')
    await mkdir(config, { recursive: true })
    const env = { ...cliEnvironment(folder), npm_config_cache: join(process.env.HOME ?? folder, '.npm') }
    await this.run(
      entry,
      executable,
      [...prefix, 'profile', 'create', 'ramu', '--mint', '--config-dir', config],
      env,
      (output) => this.show(entry, output),
    )
    return neonCliKey(config, 'ramu')
  }
}
