// The contract a resource adapter passes, and the database service around it: a provision whose reply is lost, the
// preview branch's values kept apart from production's, and migrations that stop a deploy. Neon runs against a local
// fake server with recorded replies; migrations run against a local Git origin, never a real database.
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { neonAdapter } from '../src/workspace/deploy/neon'
import { MigrationError, ResourceService, type MigrationRunner } from '../src/workspace/deploy/resources'

interface Route {
  method: string
  path: RegExp
  body: unknown
  /** Closes the connection after acting: the provider made it, the reply is lost. */
  drop?: boolean
  effect?: () => void
}

const servers: Server[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function fake(routes: Route[]) {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    expect(req.headers.authorization).toBe('Bearer neon_key')
    req.resume()
    req.on('end', () => {
      const route = routes.find((entry) => entry.method === req.method && entry.path.test(req.url ?? ''))
      if (!route) return void res.writeHead(500).end(`no recorded reply for ${req.method} ${req.url}`)
      route.effect?.()
      if (route.drop) return void req.socket.destroy()
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(route.body))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

/** Neon's replies for one account: `projects` grows when one is created, as Neon's list would. */
function neonRoutes(projects: { id: string; name: string }[]): Route[] {
  const branches = [{ id: 'br_main', name: 'main', default: true, logical_size: 31_457_280 }]
  return [
    {
      method: 'GET',
      path: /^\/users\/me$/,
      body: { id: 'u1', email: 'ana@example.com', plan: 'free', compute_seconds_limit: 360_000 },
    },
    {
      method: 'POST',
      path: /^\/projects$/,
      body: { project: { id: 'prj_1', name: 'shop' } },
      effect: () => void projects.push({ id: 'prj_1', name: 'shop' }),
    },
    { method: 'GET', path: /^\/projects\?search=shop/, body: { projects } },
    { method: 'GET', path: /^\/projects\/prj_1\/branches$/, body: { branches } },
    {
      method: 'POST',
      path: /^\/projects\/prj_1\/branches$/,
      body: { branch: { id: 'br_preview', name: 'preview' } },
      effect: () => void branches.push({ id: 'br_preview', name: 'preview', default: false, logical_size: 0 }),
    },
    {
      method: 'GET',
      path: /^\/projects\/prj_1\/branches\/br_\w+\/databases$/,
      body: { databases: [{ name: 'neondb', owner_name: 'neondb_owner' }] },
    },
    ...['main', 'preview'].flatMap((branch) =>
      [true, false].map((pooled) => ({
        method: 'GET',
        path: new RegExp(`^/projects/prj_1/connection_uri\\?branch_id=br_${branch}&.*pooled=${pooled}`),
        body: { uri: `postgresql://neondb_owner:pw@${branch}${pooled ? '-pooler' : ''}.neon.tech/neondb` },
      })),
    ),
    {
      method: 'GET',
      path: /^\/projects\/prj_1$/,
      body: {
        project: {
          id: 'prj_1',
          name: 'shop',
          synthetic_storage_size: 0,
          compute_time_seconds: 120,
          data_transfer_bytes: 2048,
          branch_logical_size_limit_bytes: 536_870_912,
          consumption_period_start: '2026-11-01T00:00:00Z',
          consumption_period_end: '2026-12-01T00:00:00Z',
        },
      },
    },
  ]
}

const auth = { token: 'neon_key' }

function credentials() {
  const secrets = new Map<string, string>()
  const store = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value: string) => void secrets.set(key, value),
    getPassword: async () => secrets.get(key) ?? null,
    deletePassword: async () => secrets.delete(key),
  }))
  store.verify = async () => {}
  return { store, secrets }
}

function service(url: string, migrate: string[] | null = null, runner?: MigrationRunner) {
  const state = new Map<string, unknown>()
  const { store, secrets } = credentials()
  const resources = new ResourceService(
    {
      getState: <T>(name: string, fallback: T) => (state.get(name) as T) ?? fallback,
      setState: (name, value) => void state.set(name, value),
      stack: () => ({ database: true, migrate }),
    },
    { auth: async () => ({ auth, accountId: 'u1', defaultScope: null }), connected: () => true } as never,
    store,
    () => neonAdapter({ api: url }),
    runner,
  )
  return { resources, state, secrets }
}

describe('Neon resource adapter', () => {
  it('reads the account, provisions a database with pooled and direct addresses, branches it and reports usage', async () => {
    const server = await fake(neonRoutes([]))
    const neon = neonAdapter({ api: server.url })
    expect(await neon.account(auth)).toMatchObject({ id: 'u1', name: 'ana@example.com' })
    const made = await neon.provision(auth, { name: 'shop' }, 'default')
    expect(made).toEqual({
      id: 'prj_1',
      name: 'shop',
      variables: {
        DATABASE_URL: 'postgresql://neondb_owner:pw@main-pooler.neon.tech/neondb',
        DATABASE_URL_UNPOOLED: 'postgresql://neondb_owner:pw@main.neon.tech/neondb',
      },
    })
    expect((await neon.branch!(auth, 'prj_1', 'preview')).DATABASE_URL).toContain('preview-pooler')
    // A second call reuses the branch instead of creating another.
    await neon.branch!(auth, 'prj_1', 'preview')
    expect(server.requests.filter((line) => line === 'POST /projects/prj_1/branches')).toHaveLength(1)
    // Storage is the main branch's size against Neon's per-branch limit; compute is measured against the plan's limit.
    expect(await neon.usage!(auth, 'prj_1')).toEqual({
      period: { start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1) },
      figures: [
        { metric: 'storage', service: null, used: 31_457_280, unit: 'bytes', limit: 536_870_912 },
        { metric: 'compute', service: null, used: 120, unit: 'seconds', limit: 360_000 },
        { metric: 'transfer', service: null, used: 2048, unit: 'bytes', limit: null },
      ],
      billingPage: 'https://console.neon.tech/app/billing',
    })
    expect(server.requests.join('\n')).not.toContain('neon_key')
  })

  it('finds the database by name when the provision reply is lost, and never creates two', async () => {
    const routes = neonRoutes([])
    routes.find((route) => route.method === 'POST' && String(route.path) === String(/^\/projects$/))!.drop = true
    const server = await fake(routes)
    const { resources, secrets } = service(server.url)
    const development = await resources.provision('p1', 'neon', 'default', 'shop')
    expect(development.DATABASE_URL).toContain('preview-pooler')
    expect(server.requests.filter((line) => line === 'POST /projects')).toHaveLength(1)
    // Connection values live only in the credential store.
    expect([...secrets.values()].join()).toContain('main-pooler')
    const status = await resources.status('p1', [])
    expect(status.resources).toEqual([
      expect.objectContaining({
        provider: 'neon',
        id: 'prj_1',
        variables: ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'],
        previewBranch: true,
        page: 'https://console.neon.tech/app/projects/prj_1',
      }),
    ])
    expect(JSON.stringify(status)).not.toContain('neon.tech/neondb')
    await expect(resources.provision('p1', 'neon', 'default', 'shop')).rejects.toThrow('already has a database')
  })

  it('gives production its own values and the preview branch to previews, this host and CI', async () => {
    const server = await fake(neonRoutes([]))
    const { resources } = service(server.url)
    expect((await resources.status('p1', [])).needs).toEqual(['database'])
    await resources.provision('p1', 'neon', 'default', 'shop')
    const values = await resources.environmentValues('p1')
    expect(values.production?.DATABASE_URL).toContain('main-pooler')
    for (const environment of ['preview', 'development', 'ci'] as const)
      expect(values[environment]?.DATABASE_URL).toContain('preview-pooler')
    await expect(resources.provision('p1', 'neon', 'large', 'shop')).rejects.toThrow('offered plans')
  })
})

describe('migrations before a production deploy', () => {
  function repository() {
    const root = mkdtempSync(join(tmpdir(), 'ramu-migrate-'))
    dirs.push(root)
    const origin = join(root, 'origin.git')
    const work = join(root, 'work')
    const run = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
    run(root, ['init', '-q', '--bare', '-b', 'main', origin])
    run(root, ['init', '-q', '-b', 'main', work])
    run(work, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one'])
    run(work, ['remote', 'add', 'origin', origin])
    run(work, ['push', '-q', 'origin', 'main'])
    return { work, run }
  }

  it('runs the migrate command with production’s values, and a failure stops the deploy with its output', async () => {
    const server = await fake(neonRoutes([]))
    const runner = vi.fn<MigrationRunner>(async () => ({ ok: false, output: 'step 1\nrelation "users" exists' }))
    const { resources } = service(server.url, ['npx', 'prisma', 'migrate', 'deploy'], runner)
    const { work } = repository()
    // No database yet: nothing to migrate.
    await resources.migrateProduction('p1', work, 'main')
    expect(runner).not.toHaveBeenCalled()
    await resources.provision('p1', 'neon', 'default', 'shop')
    const failure = await resources.migrateProduction('p1', work, 'main').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MigrationError)
    expect((failure as MigrationError).output).toContain('relation "users" exists')
    expect(runner).toHaveBeenCalledWith(
      ['npx', 'prisma', 'migrate', 'deploy'],
      work,
      expect.objectContaining({ DATABASE_URL_UNPOOLED: 'postgresql://neondb_owner:pw@main.neon.tech/neondb' }),
    )
  })

  it('refuses when the checkout is not the commit the platform will build', async () => {
    const server = await fake(neonRoutes([]))
    const runner = vi.fn<MigrationRunner>(async () => ({ ok: true, output: '' }))
    const { resources } = service(server.url, ['bin/rails', 'db:migrate'], runner)
    await resources.provision('p1', 'neon', 'default', 'shop')
    const { work, run } = repository()
    run(work, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'unpushed'])
    await expect(resources.migrateProduction('p1', work, 'main')).rejects.toThrow('Push or pull main first')
    run(work, ['checkout', '-q', '-b', 'feature'])
    await expect(resources.migrateProduction('p1', work, 'main')).rejects.toThrow('Check out main')
    expect(runner).not.toHaveBeenCalled()
  })

  it('runs a held build’s migrations only at that build’s own commit', async () => {
    const server = await fake(neonRoutes([]))
    const runner = vi.fn<MigrationRunner>(async () => ({ ok: true, output: '' }))
    const { resources } = service(server.url, ['bin/rails', 'db:migrate'], runner)
    await resources.provision('p1', 'neon', 'default', 'shop')
    const { work } = repository()
    await expect(resources.migrateProduction('p1', work, 'main', 'f'.repeat(40))).rejects.toThrow('is not at fffffff')
    expect(runner).not.toHaveBeenCalled()
  })
})

describe('a database branch per pull request', () => {
  it('opens one per git branch up to four, and closing deletes it and names the variables to remove', async () => {
    const server = await fake(neonRoutes([]))
    const branch = vi.fn(async (_auth: unknown, _id: string, name: string) => ({
      DATABASE_URL: `postgresql://${name}`,
    }))
    const removeBranch = vi.fn(async () => {})
    const state = new Map<string, unknown>()
    const { store } = credentials()
    const resources = new ResourceService(
      {
        getState: <T>(name: string, fallback: T) => (state.get(name) as T) ?? fallback,
        setState: (name, value) => void state.set(name, value),
        stack: () => ({ database: true, migrate: null }),
      },
      { auth: async () => ({ auth, accountId: 'u1', defaultScope: null }), connected: () => true } as never,
      store,
      () => ({ ...neonAdapter({ api: server.url }), branch, removeBranch }),
    )
    expect(resources.canBranch('p')).toBe(false)
    await resources.provision('p', 'neon', 'default', 'shop')
    expect(resources.canBranch('p')).toBe(true)
    expect(await resources.openBranch('p', 'Feature/Login')).toEqual({ DATABASE_URL: 'postgresql://pr-feature-login' })
    expect(await resources.openBranch('p', 'Feature/Login')).toBeNull()
    for (const name of ['a', 'b', 'c']) expect(await resources.openBranch('p', name)).not.toBeNull()
    expect(await resources.openBranch('p', 'e')).toBeNull()
    expect(resources.branchesOf('p')).toEqual(['Feature/Login', 'a', 'b', 'c'])
    expect(await resources.closeBranch('p', 'Feature/Login')).toEqual(['DATABASE_URL'])
    expect(removeBranch).toHaveBeenCalledWith(auth, 'prj_1', 'pr-feature-login')
    expect(resources.branchesOf('p')).toEqual(['a', 'b', 'c'])
    expect(await resources.closeBranch('p', 'never-opened')).toEqual([])
  })

  it('deletes a pull request’s Neon branch by name, and never the default one', async () => {
    const server = await fake([
      {
        method: 'GET',
        path: /^\/projects\/prj_1\/branches$/,
        body: {
          branches: [
            { id: 'br_main', name: 'pr-main', default: true },
            { id: 'br_pr', name: 'pr-login' },
          ],
        },
      },
      { method: 'DELETE', path: /^\/projects\/prj_1\/branches\/br_pr$/, body: {} },
    ])
    const neon = neonAdapter({ api: server.url })
    await neon.removeBranch!(auth, 'prj_1', 'pr-login')
    await neon.removeBranch!(auth, 'prj_1', 'pr-main')
    await neon.removeBranch!(auth, 'prj_1', 'pr-gone')
    expect(server.requests.filter((request) => request.startsWith('DELETE'))).toEqual([
      'DELETE /projects/prj_1/branches/br_pr',
    ])
  })
})
