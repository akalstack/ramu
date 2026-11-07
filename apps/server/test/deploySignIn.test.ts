import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { HostingAccounts } from '../src/workspace/deploy/accounts'
import { DeployError, type HostingAdapter } from '../src/workspace/deploy/adapter'
import {
  flyCliToken,
  HostingSignIns,
  netlifyCliToken,
  railwayCliToken,
  signInPrompt,
  vercelCliToken,
} from '../src/workspace/deploy/signIn'

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
const folder = async () => {
  const path = await mkdtemp(join(tmpdir(), 'ramu-deploy-test-'))
  folders.push(path)
  return path
}

it('reads the link and code from what the CLIs print, with or without terminal escapes', () => {
  expect(signInPrompt('\n  Visit https://vercel.com/oauth/device?user_code=ABCD-EFGH\n')).toEqual({
    url: 'https://vercel.com/oauth/device?user_code=ABCD-EFGH',
    code: 'ABCD-EFGH',
  })
  const linked =
    '  Visit \u001b]8;;https://vercel.com/oauth/device?user_code=WXYZ-1234\u0007vercel.com/oauth/device\u001b]8;;\u0007 and enter \u001b[1mWXYZ-1234\u001b[22m'
  expect(signInPrompt(linked)).toEqual({
    url: 'https://vercel.com/oauth/device?user_code=WXYZ-1234',
    code: 'WXYZ-1234',
  })
  expect(signInPrompt('Logging in...')).toEqual({ url: null, code: null })
  // Railway prints its one-click link, then the code on the line after.
  expect(
    signInPrompt(
      '  → Sign in with one click:\n    https://railway.com/activate?code=PLUM-RIVER\n\n  → Or go to https://railway.com/activate and enter this code:\n    PLUM-RIVER\n',
    ),
  ).toEqual({ url: 'https://railway.com/activate?code=PLUM-RIVER', code: 'PLUM-RIVER' })
})

it('reads the Railway CLI session from ~/.railway/config.json, expiry in milliseconds', async () => {
  const home = await folder()
  await mkdir(join(home, '.railway'), { recursive: true })
  await writeFile(
    join(home, '.railway', 'config.json'),
    JSON.stringify({
      projects: {},
      user: { accessToken: 'rw_1', refreshToken: 'rr_1', tokenExpiresAt: 2_000_000_000 },
    }),
  )
  expect(await railwayCliToken(home)).toEqual({ token: 'rw_1', refreshToken: 'rr_1', expiresAt: 2_000_000_000_000 })
  await expect(railwayCliToken(await folder())).rejects.toThrow('without saving')
})

it('reads the Vercel CLI login from auth.json in its configuration folder, expiry in milliseconds', async () => {
  const dir = await folder()
  await writeFile(
    join(dir, 'auth.json'),
    JSON.stringify({ token: 'vca_1', refreshToken: 'r1', expiresAt: 2_000_000_000 }),
  )
  expect(await vercelCliToken(dir)).toEqual({ token: 'vca_1', refreshToken: 'r1', expiresAt: 2_000_000_000_000 })
  const keyed = await folder()
  await writeFile(join(keyed, 'credentials.json'), '{}')
  await expect(vercelCliToken(keyed)).rejects.toThrow('Use a token instead')
  await expect(vercelCliToken(await folder())).rejects.toThrow('without saving')
})

it('reads the Netlify CLI login from its config.json on macOS and Linux', async () => {
  const config = { userId: 'u1', users: { u1: { id: 'u1', auth: { token: 'nfp_1' } } } }
  const mac = await folder()
  await mkdir(join(mac, 'Library', 'Preferences', 'netlify'), { recursive: true })
  await writeFile(join(mac, 'Library', 'Preferences', 'netlify', 'config.json'), JSON.stringify(config))
  expect(await netlifyCliToken(mac)).toEqual({ token: 'nfp_1' })
  const linux = await folder()
  await mkdir(join(linux, '.config', 'netlify'), { recursive: true })
  await writeFile(join(linux, '.config', 'netlify', 'config.json'), JSON.stringify(config))
  expect(await netlifyCliToken(linux)).toEqual({ token: 'nfp_1' })
  await expect(netlifyCliToken(await folder())).rejects.toThrow('without saving')
})

/** A child process that prints, runs `act` (as the CLI would write its files), and exits. */
function child(stdout: string, act: () => Promise<void> = async () => {}, code = 0) {
  const process = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  })
  setTimeout(async () => {
    process.stdout.emit('data', Buffer.from(stdout))
    await act()
    setTimeout(() => process.emit('close', code), 5)
  }, 5)
  return process
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
}

it('runs vercel login in a private configuration folder, shows its link, and saves the token it wrote', async () => {
  const saved: unknown[] = []
  const accounts = { save: async (...args: unknown[]) => (saved.push(args), { account: 'ana' }) }
  let config = ''
  let env: NodeJS.ProcessEnv = {}
  const spawner = vi.fn((_file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    config = args[2]!
    env = options.env
    return child('Visit https://vercel.com/oauth/device?user_code=ABCD-EFGH\n', async () => {
      // The CLI shows the link and keeps polling until the person approves.
      await until(() => signIns.status(started.id).state === 'waiting')
      await mkdir(config, { recursive: true })
      await writeFile(
        join(config, 'auth.json'),
        JSON.stringify({ token: 'vca_1', refreshToken: 'r1', expiresAt: 2_000_000_000 }),
      )
    })
  })
  const signIns = new HostingSignIns(accounts as never, () => '/bin/vercel', spawner as never)
  const started = signIns.start('vercel')
  await until(() => signIns.status(started.id).state === 'waiting')
  expect(signIns.status(started.id)).toMatchObject({
    url: 'https://vercel.com/oauth/device?user_code=ABCD-EFGH',
    code: 'ABCD-EFGH',
  })
  await until(() => signIns.status(started.id).state === 'connected')
  expect(signIns.status(started.id)).toMatchObject({ state: 'connected', account: 'ana' })
  expect(spawner.mock.calls[0]![1].slice(0, 2)).toEqual(['login', '--global-config'])
  expect(env).toMatchObject({ VERCEL_TOKEN_STORAGE: 'file', NO_COLOR: '1' })
  expect(env.CLAUDECODE).toBeUndefined()
  expect(saved).toEqual([['vercel', { token: 'vca_1', refreshToken: 'r1', expiresAt: 2_000_000_000_000 }, 'cli']])
  // The private folder, with the CLI's copy of the token, is gone.
  await until(() => !existsSync(config))
  expect(existsSync(config)).toBe(false)
})

it('runs netlify login --request in a private HOME and checks the ticket until it is authorized', async () => {
  const saved: unknown[] = []
  const accounts = { save: async (...args: unknown[]) => (saved.push(args), { account: 'Ana' }) }
  let checks = 0
  const spawner = vi.fn((_file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    const home = options.env.HOME!
    if (args.includes('--request'))
      return child(
        JSON.stringify({ ticket_id: 't1', url: 'https://app.netlify.com/authorize?response_type=ticket&ticket=t1' }),
      )
    checks++
    if (checks < 2) return child(JSON.stringify({ status: 'pending' }))
    return child(JSON.stringify({ status: 'authorized' }), async () => {
      await mkdir(join(home, '.config', 'netlify'), { recursive: true })
      await writeFile(
        join(home, '.config', 'netlify', 'config.json'),
        JSON.stringify({ userId: 'u1', users: { u1: { auth: { token: 'nfp_1' } } } }),
      )
    })
  })
  const signIns = new HostingSignIns(accounts as never, () => '/bin/netlify', spawner as never, 5)
  const started = signIns.start('netlify')
  await until(() => signIns.status(started.id).state === 'connected')
  expect(signIns.status(started.id)).toMatchObject({ state: 'connected', account: 'Ana' })
  expect(spawner.mock.calls[1]![1]).toEqual(['login', '--check', 't1', '--json'])
  expect(saved).toEqual([['netlify', { token: 'nfp_1' }, 'cli']])
})

it('runs railway login --browserless in a private HOME, shows its link and code, and saves the session', async () => {
  const saved: unknown[] = []
  const accounts = { save: async (...args: unknown[]) => (saved.push(args), { account: 'Ana' }) }
  let home = ''
  const spawner = vi.fn((_file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    home = options.env.HOME!
    return child(
      '  → Sign in with one click:\n    https://railway.com/activate?code=PLUM-RIVER\n  → Or go to https://railway.com/activate and enter this code:\n    PLUM-RIVER\n',
      async () => {
        await until(() => signIns.status(started.id).state === 'waiting')
        await mkdir(join(home, '.railway'), { recursive: true })
        await writeFile(
          join(home, '.railway', 'config.json'),
          JSON.stringify({ user: { accessToken: 'rw_1', refreshToken: 'rr_1', tokenExpiresAt: 2_000_000_000 } }),
        )
      },
    )
  })
  const signIns = new HostingSignIns(accounts as never, () => '/bin/railway', spawner as never)
  const started = signIns.start('railway')
  await until(() => signIns.status(started.id).state === 'waiting')
  expect(signIns.status(started.id)).toMatchObject({
    url: 'https://railway.com/activate?code=PLUM-RIVER',
    code: 'PLUM-RIVER',
  })
  await until(() => signIns.status(started.id).state === 'connected')
  expect(spawner.mock.calls[0]![1]).toEqual(['login', '--browserless'])
  expect(home).not.toBe(process.env.HOME)
  expect(saved).toEqual([['railway', { token: 'rw_1', refreshToken: 'rr_1', expiresAt: 2_000_000_000_000 }, 'cli']])
  await until(() => !existsSync(home))
  expect(existsSync(home)).toBe(false)
})

it('runs fly auth login in a private HOME and reads the token flyctl saved in .fly/config.yml', async () => {
  const saved: unknown[] = []
  const accounts = { save: async (...args: unknown[]) => (saved.push(args), { account: 'Ana' }) }
  let home = ''
  const spawner = vi.fn((_file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    home = options.env.HOME!
    return child(
      'Open this URL in a browser and approve the login:\n\n    https://fly.io/app/auth/cli/abc123\n\n',
      async () => {
        await until(() => signIns.status(started.id).state === 'waiting')
        await mkdir(join(home, '.fly'), { recursive: true })
        await writeFile(join(home, '.fly', 'config.yml'), 'access_token: fo1_abc\nlast_login: 2026-11-07T00:00:00Z\n')
      },
    )
  })
  const signIns = new HostingSignIns(accounts as never, () => '/bin/fly', spawner as never)
  const started = signIns.start('fly')
  await until(() => signIns.status(started.id).state === 'waiting')
  expect(signIns.status(started.id).url).toBe('https://fly.io/app/auth/cli/abc123')
  await until(() => signIns.status(started.id).state === 'connected')
  expect(spawner.mock.calls[0]![1]).toEqual(['auth', 'login'])
  expect(home).not.toBe(process.env.HOME)
  expect(saved).toEqual([['fly', { token: 'fo1_abc' }, 'cli']])
})

it('reads a quoted flyctl token, and refuses a config without one', async () => {
  const home = await folder()
  await mkdir(join(home, '.fly'), { recursive: true })
  await writeFile(join(home, '.fly', 'config.yml'), 'access_token: "FlyV1 fm2_a,fm2_b"\n')
  expect(await flyCliToken(home)).toEqual({ token: 'FlyV1 fm2_a,fm2_b' })
  await writeFile(join(home, '.fly', 'config.yml'), 'send_metrics: true\n')
  await expect(flyCliToken(home)).rejects.toThrow('without saving')
})

it('reports a missing CLI and a cancelled sign-in without saving anything', async () => {
  const accounts = { save: vi.fn() }
  expect(() => new HostingSignIns(accounts as never, () => null).start('vercel')).toThrow('Use a token instead')
  const spawner = vi.fn(() => child('', async () => new Promise((resolve) => setTimeout(resolve, 200))))
  const signIns = new HostingSignIns(accounts as never, () => '/bin/vercel', spawner as never)
  const started = signIns.start('vercel')
  await until(() => spawner.mock.calls.length > 0)
  signIns.cancel(started.id)
  expect(signIns.status(started.id)).toMatchObject({ state: 'failed', error: 'Cancelled.' })
  expect(accounts.save).not.toHaveBeenCalled()
})

function store() {
  const secrets = new Map<string, string>()
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value: string) => void secrets.set(key, value),
    getPassword: async () => secrets.get(key) ?? null,
    deletePassword: async () => secrets.delete(key),
  }))
  credentials.verify = async () => {}
  const state = new Map<string, unknown>()
  return { secrets, state, credentials }
}

const adapter = (accept: (token: string) => boolean): HostingAdapter =>
  ({
    id: 'vercel',
    name: 'Vercel',
    tokenPage: 'https://vercel.com/account/settings/tokens',
    account: async ({ token }: { token: string }) => {
      if (!accept(token)) throw new DeployError('refused', 'signed-out', 401)
      return { id: 'u1', name: 'ana', defaultScope: 'team_1', broadScope: 'whole account', expiresAt: null }
    },
    capabilities: {},
  }) as unknown as HostingAdapter

it('keeps a checked token in the credential store, shows only the account, and refuses a bad one', async () => {
  const { secrets, state, credentials } = store()
  const accounts = new HostingAccounts(
    (key, fallback) => (state.get(key) ?? fallback) as never,
    (key, value) => void state.set(key, value),
    credentials,
    fetch,
    {},
    () => ({ ...adapter((token) => token === 'good-token'), kind: 'hosting' }),
  )
  const shown = await accounts.save('vercel', { token: 'good-token' }, 'token')
  expect(shown).toMatchObject({ connected: true, account: 'ana', via: 'token', broadScope: 'whole account' })
  expect(JSON.stringify([...state.values()])).not.toContain('good-token')
  expect([...secrets.values()].join()).toContain('good-token')
  await expect(accounts.save('vercel', { token: 'bad-token' }, 'token')).rejects.toThrow('refused')
  expect((await accounts.auth('vercel')).auth.token).toBe('good-token')
  await accounts.disconnect('vercel')
  expect(accounts.connected('vercel')).toBe(false)
  await expect(accounts.auth('vercel')).rejects.toMatchObject({ kind: 'signed-out' })
})

it('renews an expiring Vercel CLI session with its refresh token, keeping the rotated one', async () => {
  const { state, credentials } = store()
  const bodies: string[] = []
  const fetcher = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body))
    return new Response(JSON.stringify({ access_token: 'vca_2', refresh_token: 'r2', expires_in: 3600 }))
  }) as typeof fetch
  const accounts = new HostingAccounts(
    (key, fallback) => (state.get(key) ?? fallback) as never,
    (key, value) => void state.set(key, value),
    credentials,
    fetcher,
    { vercel: { url: 'http://oauth.test/token', client: 'cl_test' } },
    () => ({ ...adapter(() => true), kind: 'hosting' }),
  )
  await accounts.save('vercel', { token: 'vca_1', refreshToken: 'r1', expiresAt: Date.now() + 1000 }, 'cli')
  expect((await accounts.auth('vercel')).auth.token).toBe('vca_2')
  expect(bodies[0]).toContain('grant_type=refresh_token')
  expect(bodies[0]).toContain('refresh_token=r1')
  // Fresh now: no second renewal.
  expect((await accounts.auth('vercel')).auth.token).toBe('vca_2')
  expect(bodies).toHaveLength(1)
})

it('renews a Railway CLI session through Railway’s OAuth endpoint with the CLI’s client', async () => {
  const { state, credentials } = store()
  const calls: { url: string; body: string }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) })
    return new Response(JSON.stringify({ access_token: 'rw_2', expires_in: 3600 }))
  }) as typeof fetch
  const accounts = new HostingAccounts(
    (key, fallback) => (state.get(key) ?? fallback) as never,
    (key, value) => void state.set(key, value),
    credentials,
    fetcher,
    { railway: { url: 'http://railway.test/oauth/token', client: 'rlwy_test' } },
    () => ({ ...adapter(() => true), name: 'Railway', kind: 'hosting' }),
  )
  await accounts.save('railway', { token: 'rw_1', refreshToken: 'rr_1', expiresAt: Date.now() + 1000 }, 'cli')
  expect((await accounts.auth('railway')).auth.token).toBe('rw_2')
  expect(calls[0]!.url).toBe('http://railway.test/oauth/token')
  expect(calls[0]!.body).toContain('client_id=rlwy_test')
  expect(calls[0]!.body).toContain('refresh_token=rr_1')
})
