// Platforms an agent drives through the platform's own CLI rather than through an adapter: Railway, Fly.io,
// Cloudflare and Supabase. Agents already know these CLIs, so Ramu adds only what an agent cannot do for itself: the
// token stays on the host (passed to the CLI in its environment, never in the arguments or the transcript), commands
// that only read run straight away, and every other command asks the person with a card naming it.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliPlatform } from '@ramu/shared/types/deploy'
import { DeployError, graphqlCall, platformCall, type HostingAuth, type HostingIdentity } from './adapter'
import { cliEnvironment, platformCli } from './signIn'

export interface CliPlatformSpec {
  name: string
  tokenPage: string
  /** The environment variable the CLI reads its token from. */
  tokenEnv: string
  /** The CLI's own names, then the published package run through npx when none is installed. */
  binaries: string[]
  npx: string | null
  /** Argument prefixes that only read: they run without asking. Everything else asks the person. */
  reads: string[][]
  account(auth: HostingAuth, fetcher?: typeof fetch): Promise<HostingIdentity>
}

/**
 * A Fly.io token as its GraphQL API takes it: macaroons (`fm1r_`, `fm2_`) after `FlyV1`, a user token after `Bearer`,
 * whatever scheme the person copied it with.
 */
export function flyAuthorization(token: string): string {
  const parts = token
    .trim()
    .replace(/^(?:(?:FlyV1|Bearer)\s+)+/i, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const macaroons = parts.some((part) => /^(fm1r|fm1a|fm2)_/.test(part))
  return `${macaroons ? 'FlyV1' : 'Bearer'} ${parts.join(',')}`
}

const HELP: string[][] = [['--help'], ['-h'], ['help'], ['--version'], ['version']]

export const CLI_PLATFORM_SPECS: Record<CliPlatform, CliPlatformSpec> = {
  railway: {
    name: 'Railway',
    tokenPage: 'https://railway.com/account/tokens',
    tokenEnv: 'RAILWAY_API_TOKEN',
    binaries: ['railway'],
    npx: '@railway/cli',
    // `railway variables` prints secret values, so it asks like a change does.
    reads: [...HELP, ['whoami'], ['status'], ['list'], ['logs'], ['environment', 'list'], ['service', 'list']],
    async account(auth, fetcher = fetch) {
      const url = 'https://backboard.railway.com/graphql/v2'
      // An account token answers `me`; a workspace token does not, and names its workspace instead.
      const me = await graphqlCall<{ me: { id: string; name?: string | null; email?: string } }>(
        'Railway',
        fetcher,
        url,
        auth,
        'query Me { me { id name email } }',
        {},
        'reading the account',
      ).catch(() => null)
      if (me)
        return {
          id: me.me.id,
          name: me.me.name || me.me.email || me.me.id,
          defaultScope: null,
          broadScope: null,
          expiresAt: null,
        }
      const { apiToken } = await graphqlCall<{ apiToken: { workspaces: { id: string; name: string }[] } }>(
        'Railway',
        fetcher,
        url,
        auth,
        'query Token { apiToken { workspaces { id name } } }',
        {},
        'reading the token',
      )
      const workspace = apiToken.workspaces[0]
      if (!workspace) throw new DeployError('This Railway token reaches no workspace.', 'missing-permission')
      return { id: workspace.id, name: workspace.name, defaultScope: workspace.id, broadScope: null, expiresAt: null }
    },
  },
  fly: {
    name: 'Fly.io',
    tokenPage: 'https://fly.io/dashboard/personal/tokens',
    tokenEnv: 'FLY_API_TOKEN',
    binaries: ['fly', 'flyctl'],
    npx: null,
    reads: [
      ...HELP,
      ['auth', 'whoami'],
      ['status'],
      ['logs', '--no-tail'],
      ['apps', 'list'],
      ['machines', 'list'],
      ['releases'],
      ['secrets', 'list'],
      ['config', 'show'],
      ['orgs', 'list'],
      ['ips', 'list'],
      ['certs', 'list'],
      ['certs', 'show'],
      ['volumes', 'list'],
    ],
    async account(auth, fetcher = fetch) {
      const { viewer } = await graphqlCall<{ viewer: { id?: string | null; email?: string; name?: string | null } }>(
        'Fly.io',
        fetcher,
        'https://api.fly.io/graphql',
        { token: auth.token, headers: { Authorization: flyAuthorization(auth.token) } },
        'query Viewer { viewer { ... on User { id email name } } }',
        {},
        'reading the account',
      )
      return {
        id: viewer.id ?? 'fly',
        name: viewer.name || viewer.email || 'Fly.io',
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
  },
  cloudflare: {
    name: 'Cloudflare',
    tokenPage: 'https://dash.cloudflare.com/profile/api-tokens',
    tokenEnv: 'CLOUDFLARE_API_TOKEN',
    binaries: ['wrangler'],
    npx: 'wrangler@4',
    reads: [
      ...HELP,
      ['whoami'],
      ['deployments', 'list'],
      ['versions', 'list'],
      ['pages', 'project', 'list'],
      ['pages', 'deployment', 'list'],
      ['d1', 'list'],
      ['kv', 'namespace', 'list'],
      ['r2', 'bucket', 'list'],
      ['secret', 'list'],
    ],
    async account(auth, fetcher = fetch) {
      const api = 'https://api.cloudflare.com/client/v4'
      const verified = await platformCall<{ result?: { status?: string; expires_on?: string } }>(
        'Cloudflare',
        fetcher,
        `${api}/user/tokens/verify`,
        auth,
        'checking the token',
      )
      if (verified.result?.status !== 'active')
        throw new DeployError('This Cloudflare token is not active.', 'signed-out')
      const accounts = await platformCall<{ result?: { id: string; name: string }[] }>(
        'Cloudflare',
        fetcher,
        `${api}/accounts`,
        auth,
        'reading the accounts',
      )
      const account = accounts.result?.[0]
      if (!account) throw new DeployError('This Cloudflare token reaches no account.', 'missing-permission')
      return {
        id: account.id,
        name: account.name,
        defaultScope: account.id,
        broadScope:
          (accounts.result?.length ?? 0) > 1 ? 'Create a token limited to the one account your apps go in.' : null,
        expiresAt: verified.result.expires_on ? Date.parse(verified.result.expires_on) : null,
      }
    },
  },
  supabase: {
    name: 'Supabase',
    tokenPage: 'https://supabase.com/dashboard/account/tokens',
    tokenEnv: 'SUPABASE_ACCESS_TOKEN',
    binaries: ['supabase'],
    npx: 'supabase',
    reads: [
      ...HELP,
      ['projects', 'list'],
      ['orgs', 'list'],
      ['branches', 'list'],
      ['functions', 'list'],
      ['secrets', 'list'],
      ['migration', 'list'],
    ],
    async account(auth, fetcher = fetch) {
      const orgs = await platformCall<{ id: string; name: string }[]>(
        'Supabase',
        fetcher,
        'https://api.supabase.com/v1/organizations',
        auth,
        'reading the organizations',
      )
      const org = orgs[0]
      if (!org) throw new DeployError('This Supabase token reaches no organization.', 'missing-permission')
      return { id: org.id, name: org.name, defaultScope: null, broadScope: null, expiresAt: null }
    },
  },
}

/** Whether a command only reads: its arguments start with one of the platform's read prefixes. */
export function cliCommandReads(platform: CliPlatform, args: readonly string[]): boolean {
  return CLI_PLATFORM_SPECS[platform].reads.some(
    (prefix) => prefix.length <= args.length && prefix.every((part, index) => args[index] === part),
  )
}

/** The CLI to run and the arguments before the agent's: the installed one, else its package through npx. */
export function cliCommand(
  platform: CliPlatform,
  find: (name: string) => string | null = platformCli,
): { executable: string; prefix: string[] } | null {
  const spec = CLI_PLATFORM_SPECS[platform]
  for (const name of spec.binaries) {
    const found = find(name)
    if (found) return { executable: found, prefix: [] }
  }
  const npx = spec.npx ? find('npx') : null
  return npx && spec.npx ? { executable: npx, prefix: ['--yes', spec.npx] } : null
}

const OUTPUT_LIMIT = 48_000
const TIMEOUT_MS = 10 * 60_000

/** The end of a long output, with every occurrence of the token replaced, and terminal escapes stripped. */
export function cliOutput(output: string, token: string): string {
  // eslint-disable-next-line no-control-regex -- strips terminal colour escapes from CLI output
  let text = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  if (token) text = text.split(token).join('[token]')
  return text.length > OUTPUT_LIMIT ? `…${text.slice(-OUTPUT_LIMIT)}` : text
}

export interface CliRun {
  exitCode: number | null
  output: string
  timedOut: boolean
}

/**
 * Runs the platform's CLI in `cwd` with the token in its environment and none of Ramu's. HOME is a folder of Ramu's
 * own per platform, so the CLI never reads or writes the person's own CLI sign-in.
 */
export async function runPlatformCli(
  platform: CliPlatform,
  args: readonly string[],
  cwd: string,
  auth: { token: string; accountId: string | null },
  signal?: AbortSignal,
  spawner: typeof spawn = spawn,
): Promise<CliRun> {
  const command = cliCommand(platform)
  if (!command)
    throw new Error(
      `The ${CLI_PLATFORM_SPECS[platform].name} CLI is not installed on this host. Ask the person to install it.`,
    )
  const home = join(tmpdir(), 'ramu-cli', platform)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const env: NodeJS.ProcessEnv = {
    ...cliEnvironment(home),
    [CLI_PLATFORM_SPECS[platform].tokenEnv]: auth.token,
    CI: '1',
    ...(platform === 'cloudflare' && auth.accountId ? { CLOUDFLARE_ACCOUNT_ID: auth.accountId } : {}),
  }
  return new Promise((resolve, reject) => {
    const child = spawner(command.executable, [...command.prefix, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length > OUTPUT_LIMIT * 2) output = output.slice(-OUTPUT_LIMIT * 2)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const stop = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, TIMEOUT_MS)
    signal?.addEventListener('abort', stop, { once: true })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve({ exitCode: code, output: cliOutput(output, auth.token), timedOut })
    })
  })
}
