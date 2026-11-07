import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EnvEnvironment } from '@ramu/shared/envSync'
import type { ProviderEnvironmentStore } from '../src/providers/environmentStore'
import { netlifyAdapter } from '../src/workspace/deploy/netlify'
import { vercelAdapter } from '../src/workspace/deploy/vercel'
import { envStatus, hostTarget, readAppVariables, syncEnv, type EnvTarget } from '../src/workspace/deploy/envSync'

interface Call {
  method: string
  url: string
  body: unknown
}

/** A platform API that answers from a table and records each request with its body. */
function api(answer: (method: string, url: string) => unknown) {
  const calls: Call[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify(answer(method, url) ?? {}), { status: 200 })
  }) as typeof fetch
  return { calls, fetcher }
}

const auth = { token: 'tok_1', scope: 'team_1' }
const site = { siteId: 'prj_1', siteName: 'shop' }

describe('hosting adapters’ environment variables', () => {
  it('Vercel lists names per target and upserts encrypted values for one target', async () => {
    const { calls, fetcher } = api(() => ({
      envs: [
        { key: 'DATABASE_URL', target: ['production', 'preview'], value: 'hidden' },
        { key: 'STRIPE_KEY', target: 'production' },
      ],
    }))
    const env = vercelAdapter({ api: 'https://vercel.test', fetch: fetcher }).capabilities.environment!
    expect(await env.list(auth, site)).toEqual({
      preview: ['DATABASE_URL'],
      production: ['DATABASE_URL', 'STRIPE_KEY'],
    })
    await env.set(auth, site, 'preview', { STRIPE_KEY: 'sk_test' })
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: 'https://vercel.test/v10/projects/prj_1/env?upsert=true&teamId=team_1',
      body: [{ key: 'STRIPE_KEY', value: 'sk_test', type: 'encrypted', target: ['preview'] }],
    })
  })

  it('Netlify reads the team’s variables for the site, adds new ones and sets another context on existing ones', async () => {
    const { calls, fetcher } = api((method, url) => {
      if (url.endsWith('/sites/site_1')) return { account_id: 'acct_1' }
      if (method === 'GET')
        return [
          { key: 'DATABASE_URL', values: [{ context: 'all' }] },
          { key: 'STRIPE_KEY', values: [{ context: 'production' }] },
        ]
      return {}
    })
    const env = netlifyAdapter({ api: 'https://netlify.test', fetch: fetcher }).capabilities.environment!
    const target = { siteId: 'site_1', siteName: 'shop' }
    expect(await env.list(auth, target)).toEqual({
      preview: ['DATABASE_URL'],
      production: ['DATABASE_URL', 'STRIPE_KEY'],
    })
    await env.set(auth, target, 'preview', { STRIPE_KEY: 'sk_test', RESEND_KEY: 're_1' })
    const writes = calls.filter((call) => call.method !== 'GET')
    expect(writes).toEqual([
      {
        method: 'POST',
        url: 'https://netlify.test/accounts/acct_1/env?site_id=site_1',
        body: [{ key: 'RESEND_KEY', values: [{ context: 'deploy-preview', value: 're_1' }] }],
      },
      {
        method: 'PATCH',
        url: 'https://netlify.test/accounts/acct_1/env/STRIPE_KEY?site_id=site_1',
        body: { context: 'deploy-preview', value: 'sk_test' },
      },
    ])
  })
})

/** A target kept in memory, recording what was written to it. */
function memory(id: string, environments: EnvEnvironment[], names: Partial<Record<EnvEnvironment, string[]>>) {
  const written: { environment: EnvEnvironment; values: Record<string, string> }[] = []
  const target: EnvTarget = {
    id,
    name: id,
    environments,
    list: async () => names,
    async set(environment, values) {
      written.push({ environment, values })
      names[environment] = [...(names[environment] ?? []), ...Object.keys(values)]
    },
  }
  return { target, written }
}

function hostStore(values: Record<string, string>, state: 'available' | 'unavailable' = 'available') {
  const global = Object.entries(values).map(([key, value]) => ({ key, value }))
  return {
    status: (withValues: boolean) => ({
      state,
      keys: { global: global.map((entry) => entry.key) },
      ...(withValues && state === 'available' ? { values: { global } } : {}),
      canAdminister: withValues,
    }),
  } as unknown as ProviderEnvironmentStore
}

describe('secrets sync', () => {
  it('shows names only, host first, and what this host lacks', async () => {
    const host = hostTarget(hostStore({ DATABASE_URL: 'postgres://secret' }))
    const ci = memory('github', ['ci'], { ci: ['DATABASE_URL'] })
    const status = await envStatus(['DATABASE_URL', 'STRIPE_KEY'], [host, ci.target])
    expect(status.columns.map((column) => [column.target, column.environment, column.names])).toEqual([
      ['host', 'development', ['DATABASE_URL']],
      ['github', 'ci', ['DATABASE_URL']],
    ])
    expect(status.missingOnHost).toEqual(['STRIPE_KEY'])
    expect(JSON.stringify(status)).not.toContain('postgres://secret')
  })

  it('writes each missing variable the host has to every place, and leaves unreadable places alone', async () => {
    const host = hostTarget(hostStore({ DATABASE_URL: 'db', STRIPE_KEY: 'sk', UNUSED: 'x' }))
    const ci = memory('github', ['ci'], { ci: ['DATABASE_URL'] })
    const platform = memory('vercel', ['preview', 'production'], { production: ['STRIPE_KEY'] })
    const broken: EnvTarget = {
      ...memory('netlify', ['preview'], {}).target,
      list: async () => {
        throw new Error('Netlify refused the saved sign-in.')
      },
      set: async () => {
        throw new Error('never called')
      },
    }
    const status = await syncEnv(['DATABASE_URL', 'STRIPE_KEY', 'RESEND_KEY'], host, [
      ci.target,
      platform.target,
      broken,
    ])
    expect(ci.written).toEqual([{ environment: 'ci', values: { STRIPE_KEY: 'sk' } }])
    expect(platform.written).toEqual([
      { environment: 'preview', values: { DATABASE_URL: 'db', STRIPE_KEY: 'sk' } },
      { environment: 'production', values: { DATABASE_URL: 'db' } },
    ])
    expect(status.missingOnHost).toEqual(['RESEND_KEY'])
    expect(status.columns.find((column) => column.target === 'netlify')?.error).toBe(
      'Netlify refused the saved sign-in.',
    )
  })

  it('stops before writing anything when the host’s values are locked', async () => {
    const host = hostTarget(hostStore({ DATABASE_URL: 'db' }, 'unavailable'))
    const ci = memory('github', ['ci'], {})
    await expect(syncEnv(['DATABASE_URL'], host, [ci.target])).rejects.toThrow('Unlock')
    expect(ci.written).toEqual([])
  })
})

describe('the app’s variables', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads example files and code Git would track, not ignored folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ramu-env-'))
    dirs.push(root)
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(root, '.env.example'), 'DATABASE_URL=\n')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/app.ts'), 'process.env.STRIPE_KEY')
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules/pkg/index.js'), 'process.env.LIBRARY_ONLY')
    writeFileSync(join(root, 'notes.md'), 'process.env.DOCS_ONLY')
    expect(await readAppVariables(root)).toEqual(['DATABASE_URL', 'STRIPE_KEY'])
  })
})
