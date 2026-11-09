// Store releases: Expo's API against a local fake server with recorded replies, Release through a fake `eas` runner,
// the deploy watch through a build and its submission, and the release tools' approval.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EAS_JSON } from '@ramu/shared/storeRelease'
import type { StoreBuild } from '@ramu/shared/types/deploy'
import { DeployError } from '../src/workspace/deploy/adapter'
import { DeployWatches } from '../src/workspace/deploy/deployWatch'
import type { EnvTarget } from '../src/workspace/deploy/envSync'
import { expoClient } from '../src/workspace/deploy/expo'
import { StoreReleases } from '../src/workspace/deploy/release'
import { registerReleaseTools } from '../src/workspace/deploy/tools'
import { ProjectWake } from '../src/workspace/deploy/wake'

const APP = '1f0e2c4e-0000-4000-8000-000000000001'
const BUILD = '0b6d6a2e-0000-4000-8000-0000000000b1'

const servers: Server[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A build as Expo's GraphQL API reports it. */
const rawBuild = (patch: Record<string, unknown> = {}) => ({
  id: BUILD,
  status: 'FINISHED',
  platform: 'IOS',
  buildProfile: 'production',
  appVersion: '1.0.0',
  appBuildVersion: '7',
  gitCommitHash: 'a1b2c3d',
  gitCommitMessage: 'Add booking\n\nDetails',
  createdAt: '2026-11-01T10:00:00.000Z',
  logFiles: [] as string[],
  error: null,
  app: { id: APP, slug: 'barber', ownerAccount: { name: 'barbershop' } },
  submissions: [] as unknown[],
  ...patch,
})

interface Seen {
  url: string
  auth: string | undefined
  body: string
}

/** Answers GraphQL by the operation's name, and serves log files as JSON lines. */
async function fakeExpo(answer: (operation: string, variables: Record<string, unknown>) => unknown) {
  const seen: Seen[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body })
      if (req.url?.startsWith('/logs/'))
        return void res.end(
          [
            JSON.stringify({ msg: 'Installing pods' }),
            JSON.stringify({ msg: 'Signing failed: no distribution certificate' }),
          ].join('\n'),
        )
      const { query, variables } = JSON.parse(body) as { query: string; variables: Record<string, unknown> }
      const operation = /query (\w+)/.exec(query)?.[1] ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer(operation, variables)))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, seen, client: expoClient({ api: url, site: 'https://expo.dev', logUrl: () => true }) }
}

describe('Expo client', () => {
  it('reads the account, the builds with their submissions, and logs without sending the token to storage', async () => {
    let logBase = ''
    const { client, seen, url } = await fakeExpo((operation) => {
      if (operation === 'Me') return { data: { meActor: { __typename: 'Robot', id: 'r1', displayName: 'ramu-bot' } } }
      if (operation === 'Builds')
        return {
          data: {
            app: {
              byId: {
                builds: [
                  rawBuild({
                    status: 'IN_PROGRESS',
                    submissions: [
                      { id: 's0', status: 'ERRORED', createdAt: '2026-11-01T10:00:00Z', error: { message: 'old' } },
                      { id: 's1', status: 'AWAITING_BUILD', createdAt: '2026-11-01T11:00:00Z', logFiles: [] },
                    ],
                  }),
                ],
              },
            },
          },
        }
      return { data: { builds: { byId: rawBuild({ logFiles: [`${logBase}/logs/build.txt`] }) } } }
    })
    logBase = url
    const auth = { token: 'expo_token_1' }
    expect(await client.account(auth)).toMatchObject({ id: 'r1', name: 'ramu-bot', broadScope: null })
    const [build] = await client.builds(auth, APP, 10)
    expect(build).toMatchObject<Partial<StoreBuild>>({
      platform: 'ios',
      state: 'building',
      version: '1.0.0',
      buildNumber: '7',
      message: 'Add booking',
      page: `https://expo.dev/accounts/barbershop/projects/barber/builds/${BUILD}`,
      submission: {
        id: 's1',
        state: 'queued',
        track: null,
        error: null,
        createdAt: Date.parse('2026-11-01T11:00:00Z'),
      },
    })
    expect(await client.logs(auth, APP, BUILD, 'build', 1)).toBe('Signing failed: no distribution certificate')
    await expect(client.logs(auth, 'another-app', BUILD, 'build', 10)).rejects.toThrow('not one of this app')
    expect(
      seen.filter((entry) => entry.url === '/graphql').every((entry) => entry.auth === 'Bearer expo_token_1'),
    ).toBe(true)
    expect(seen.find((entry) => entry.url.startsWith('/logs/'))?.auth).toBeUndefined()
  })

  it('reads the app owner’s build credits and update users for the billing period, beside the plan’s limits', async () => {
    let usageVariables: Record<string, unknown> = {}
    const { client } = await fakeExpo((operation, variables) => {
      if (operation === 'AppOwner')
        return { data: { app: { byId: { ownerAccount: { id: 'acct-1', name: 'barbershop' } } } } }
      usageVariables = variables
      const period = { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' }
      return {
        data: {
          account: {
            byId: {
              usageMetrics: {
                builds: { billingPeriod: period, planMetrics: [{ serviceMetric: 'BUILDS', value: 12, limit: 30 }] },
                updates: {
                  billingPeriod: period,
                  planMetrics: [
                    { serviceMetric: 'UNIQUE_UPDATERS', value: 340, limit: 1000 },
                    { serviceMetric: 'BANDWIDTH_USAGE', value: 5, limit: 100 },
                  ],
                },
              },
            },
          },
        },
      }
    })
    const usage = await client.usage({ token: 'expo_token_1' }, APP)
    expect(usageVariables.accountId).toBe('acct-1')
    expect(usage.figures).toEqual([
      { metric: 'service', service: 'Build credits', unit: 'credits', used: 12, limit: 30 },
      { metric: 'service', service: 'Update users', unit: 'users', used: 340, limit: 1000 },
    ])
    expect(usage.period).toEqual({ start: Date.parse('2026-11-01T00:00:00Z'), end: Date.parse('2026-12-01T00:00:00Z') })
    expect(usage.billingPage).toBe('https://expo.dev/accounts/barbershop/settings/usage')
  })

  it('maps GraphQL refusals to the shared kinds without showing their text', async () => {
    const { client } = await fakeExpo(() => ({
      errors: [{ message: 'secret detail', extensions: { errorCode: 'UNAUTHENTICATED' } }],
    }))
    const refused = await client.account({ token: 'bad' }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(DeployError)
    expect((refused as DeployError).kind).toBe('signed-out')
    expect((refused as Error).message).not.toContain('secret detail')
  })
})

/** An Expo app checkout on its default branch, ready for the stores unless `patch` changes app.json. */
function expoApp(patch: Record<string, unknown> = {}, easJson: string | null = EAS_JSON): string {
  const root = mkdtempSync(join(tmpdir(), 'ramu-release-'))
  dirs.push(root)
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'assets', 'icon.png'), 'png')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { expo: '54.0.0' } }))
  const eas = easJson && JSON.parse(easJson)
  if (eas) {
    eas.submit.production.ios = { ascAppId: '6450000000' }
    writeFileSync(join(root, 'eas.json'), JSON.stringify(eas))
  }
  writeFileSync(
    join(root, 'app.json'),
    JSON.stringify({
      expo: {
        name: 'Barber',
        version: '1.0.0',
        icon: './assets/icon.png',
        ios: { bundleIdentifier: 'com.barber.app' },
        android: { package: 'com.barber.app' },
        extra: { eas: { projectId: APP } },
        ...patch,
      },
    }),
  )
  return root
}

const secrets = { set: vi.fn(async () => {}) } as unknown as EnvTarget & { set: ReturnType<typeof vi.fn> }

function releases(root: string, stdout = JSON.stringify([{ id: BUILD, platform: 'IOS' }])) {
  const run = vi.fn(async (_args: string[], _options: { cwd: string; token: string }) => stdout)
  const client = {
    build: vi.fn(async () => ({ id: BUILD }) as StoreBuild),
    builds: vi.fn(async () => []),
    app: vi.fn(async () => ({ name: 'Barber', page: 'https://expo.dev/accounts/barbershop/projects/barber' })),
  }
  const service = new StoreReleases(
    { roots: () => [root], actionsSecrets: () => secrets },
    {
      auth: async () => ({ auth: { token: 'expo_token_1' }, accountId: 'r1', defaultScope: null }),
      accountName: () => 'ramu-bot',
    },
    client as never,
    run,
  )
  return { service, run, client }
}

describe('Release', () => {
  it('runs eas build for the chosen stores as an argument list, with the token only in its environment', async () => {
    const root = expoApp()
    const { service, run } = releases(root)
    expect((await service.status('p1')).checks.every((check) => check.state === 'ok')).toBe(true)
    expect(await service.start('p1', 'ios')).toEqual([{ id: BUILD }])
    expect(run).toHaveBeenCalledWith(
      [
        'build',
        '--platform',
        'ios',
        '--profile',
        'production',
        '--auto-submit-with-profile',
        'production',
        '--non-interactive',
        '--no-wait',
        '--json',
      ],
      { cwd: root, token: 'expo_token_1' },
    )
  })

  it('refuses while a store check is missing, without starting anything', async () => {
    const { service, run } = releases(expoApp({ ios: {} }))
    await expect(service.start('p1', 'all')).rejects.toThrow('No iOS bundle identifier')
    // Android needs nothing iOS lacks.
    await expect(service.start('p1', 'android')).resolves.toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('says what update previews still need, and opens no pull request until the app has it', async () => {
    const { service } = releases(expoApp())
    const status = await service.status('p1')
    expect(status.previews).toEqual({
      needs: ['expo-updates', 'runtime-version', 'updates-url'],
      developmentBuild: false,
      workflow: false,
    })
    await expect(service.proposePreviews('p1')).rejects.toThrow('npx expo install expo-updates')
    expect(secrets.set).not.toHaveBeenCalled()
    const ready = expoApp({ runtimeVersion: { policy: 'appVersion' }, updates: { url: `https://u.expo.dev/${APP}` } })
    writeFileSync(
      join(ready, 'package.json'),
      JSON.stringify({ dependencies: { expo: '54.0.0', 'expo-updates': '1.0.0', 'expo-dev-client': '1.0.0' } }),
    )
    expect((await releases(ready).service.status('p1')).previews).toEqual({
      needs: [],
      developmentBuild: true,
      workflow: false,
    })
  })

  it('returns every started build even when reading one back fails, so none is started twice', async () => {
    const { service, client } = releases(expoApp())
    client.build.mockRejectedValueOnce(new Error('EAS did not answer'))
    expect(await service.start('p1', 'ios')).toEqual([
      expect.objectContaining({ id: BUILD, platform: 'ios', state: 'queued' }),
    ])
  })

  it('says to check expo.dev when EAS does not report the builds it started', async () => {
    const { service } = releases(expoApp(), 'Uploading…')
    await expect(service.start('p1', 'all')).rejects.toThrow('Check the builds on expo.dev')
  })

  it('treats an app.json as a store app only when the app depends on Expo', () => {
    const root = mkdtempSync(join(tmpdir(), 'ramu-release-'))
    dirs.push(root)
    // A Heroku-style app.json alone is not an Expo app.
    writeFileSync(join(root, 'app.json'), JSON.stringify({ name: 'api', stack: 'heroku-22' }))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '5.0.0' } }))
    expect(releases(root).service.storeApp('p1')).toBe(false)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { expo: '54.0.0' } }))
    expect(releases(root).service.storeApp('p1')).toBe(true)
  })

  it('reports no app for a project without one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ramu-release-'))
    dirs.push(root)
    expect((await releases(root).service.status('p1')).app).toBeNull()
  })
})

function watchSetup(builds: StoreBuild[]) {
  const cwd = mkdtempSync(join(tmpdir(), 'ramu-release-watch-'))
  dirs.push(cwd)
  execFileSync('git', ['init', '-q', '-b', 'main', cwd])
  const state = new Map<string, unknown>()
  const enqueueBackground = vi.fn()
  const sessions = [{ id: 's1', taskId: 't1', cwd, state: 'idle', parentId: null }]
  const tasks = [{ id: 't1', projectId: 'p1', status: 'active', lastActiveAt: 1 }]
  const wake = new ProjectWake(
    { exec: () => {} },
    { getTask: () => tasks[0], listTasks: () => tasks } as never,
    {
      get: () => sessions[0],
      list: () => sessions,
      enqueueBackground,
    } as never,
  )
  const releasesFake = {
    build: vi.fn(async () => builds.shift()!),
    logs: vi.fn(async (_project: string, _id: string, of: string) => `${of} log: Signing failed TOKEN=abcd1234secret`),
  }
  const watches = new DeployWatches(
    {
      getState: <T>(key: string, fallback: T) => (state.get(key) as T) ?? fallback,
      setState: (key, value) => void state.set(key, value),
      migrate: () => null,
    },
    wake,
    { binding: () => null, project: vi.fn(), deployment: vi.fn(), logs: vi.fn() } as never,
    releasesFake,
  )
  return { watches, enqueueBackground, releasesFake }
}

const storeBuild = (patch: Partial<StoreBuild>): StoreBuild => ({
  id: BUILD,
  platform: 'ios',
  state: 'building',
  profile: 'production',
  version: '1.0.0',
  buildNumber: '7',
  commit: null,
  message: null,
  error: null,
  createdAt: Date.now(),
  page: 'https://expo.dev/b',
  submission: null,
  ...patch,
})

describe('release watch', () => {
  it('waits for the submission, then tells the thread the build is on TestFlight', async () => {
    const pending = { id: 's1', state: 'queued' as const, track: null, error: null, createdAt: 0 }
    const { watches, enqueueBackground } = watchSetup([
      storeBuild({ state: 'building', submission: pending }),
      storeBuild({ state: 'ready', submission: pending }),
      storeBuild({ state: 'ready', submission: { ...pending, state: 'ready' } }),
    ])
    watches.followRelease('p1', BUILD, 's1')
    let now = Date.now()
    for (let i = 0; i < 2; i++) await watches.tick((now += 31_000))
    expect(enqueueBackground).not.toHaveBeenCalled()
    await watches.tick((now += 31_000))
    expect(enqueueBackground).toHaveBeenCalledTimes(1)
    expect(enqueueBackground.mock.calls[0]![1]).toContain('The iOS store build 1.0.0 (7) is uploaded to TestFlight')
    await watches.tick(now + 31_000)
    expect(enqueueBackground).toHaveBeenCalledTimes(1)
  })

  it('wakes the thread with the redacted log when a build or its submission fails', async () => {
    const { watches, enqueueBackground, releasesFake } = watchSetup([
      storeBuild({ state: 'failed', error: 'Signing failed' }),
      storeBuild({
        platform: 'android',
        state: 'ready',
        submission: { id: 's1', state: 'failed', track: 'internal', error: 'No service account', createdAt: 0 },
      }),
    ])
    watches.followRelease('p1', BUILD, 's1')
    await watches.tick(Date.now() + 31_000)
    const failed = enqueueBackground.mock.calls[0]![1] as string
    expect(failed).toContain('failed on EAS')
    expect(failed).toContain('EAS says: Signing failed')
    expect(failed).toContain('build log: Signing failed')
    expect(failed).not.toContain('abcd1234secret')
    watches.followRelease('p1', BUILD, 's1')
    await watches.tick(Date.now() + 62_000)
    expect(enqueueBackground.mock.calls[1]![1]).toContain('its submission to Play’s internal track failed')
    expect(releasesFake.logs).toHaveBeenLastCalledWith('p1', BUILD, 'submission')
  })
})

describe('release tools', () => {
  function tools(approve: boolean) {
    const handlers = new Map<string, (args: Record<string, unknown>, extra: object) => Promise<unknown>>()
    const server = { registerTool: (name: string, _def: unknown, handler: never) => void handlers.set(name, handler) }
    const releasesFake = {
      status: vi.fn(async () => ({
        app: { name: 'Barber', projectId: APP, page: null },
        connected: true,
        account: 'ramu-bot',
        checks: [{ id: 'version' as const, state: 'ok' as const, detail: '1.0.0' }],
        previews: null,
        builds: [],
        error: null,
      })),
      start: vi.fn(async () => [storeBuild({})]),
      logs: vi.fn(async () => ''),
    }
    const watch = { followRelease: vi.fn() }
    const asked: string[] = []
    registerReleaseTools(
      server as never,
      releasesFake,
      watch,
      { id: 's1', parentId: null } as never,
      'p1',
      async (detail) => {
        asked.push(detail)
        return approve
      },
    )
    return { handlers, releasesFake, watch, asked }
  }

  it('always ask before a release, never start one when refused, and follow it when approved', async () => {
    const refused = tools(false)
    await expect(refused.handlers.get('release_start')!({ platform: 'android' }, {})).rejects.toThrow('declined')
    expect(refused.releasesFake.start).not.toHaveBeenCalled()
    expect(refused.asked[0]).toContain('Release Barber 1.0.0 to the stores')
    expect(refused.asked[0]).toContain('nothing is submitted for review')
    const approved = tools(true)
    await approved.handlers.get('release_start')!({}, {})
    expect(approved.releasesFake.start).toHaveBeenCalledWith('p1', 'all')
    expect(approved.watch.followRelease).toHaveBeenCalledWith('p1', BUILD, 's1')
  })
})

describe('an app.config app', () => {
  it('checks the configuration its code computes once the person asks Ramu to run expo config', async () => {
    const root = expoApp()
    writeFileSync(join(root, 'app.config.js'), 'module.exports = ({ config }) => ({ ...config, ios: {} })')
    const config = vi.fn(
      async () =>
        'Some log line\n' + JSON.stringify({ name: 'Barber', ios: { bundleIdentifier: 'com.barber.dynamic' } }),
    )
    const service = new StoreReleases(
      { roots: () => [root], actionsSecrets: () => secrets },
      {
        auth: async () => ({ auth: { token: 'expo_token_1' }, accountId: 'r1', defaultScope: null }),
        accountName: () => 'ramu-bot',
      },
      {
        build: vi.fn(),
        builds: vi.fn(async () => []),
        app: vi.fn(async () => ({ name: 'Barber', page: '' })),
      } as never,
      vi.fn(),
      config,
    )
    const before = await service.status('p1')
    expect(before.checks.find((check) => check.id === 'dynamic-config')).toMatchObject({ state: 'warning' })
    expect(config).not.toHaveBeenCalled()
    const after = await service.resolveConfig('p1')
    expect(config).toHaveBeenCalledWith(root)
    expect(after.checks.find((check) => check.id === 'dynamic-config')).toBeUndefined()
    expect(after.checks.find((check) => check.id === 'ios-bundle')).toMatchObject({ detail: 'com.barber.dynamic' })
  })

  it('reads build logs through the EAS project its code computes', async () => {
    const root = expoApp({ extra: {} })
    writeFileSync(join(root, 'app.config.js'), 'module.exports = ({ config }) => config')
    const logs = vi.fn(async () => 'Build failed')
    const service = new StoreReleases(
      { roots: () => [root], actionsSecrets: () => secrets },
      {
        auth: async () => ({ auth: { token: 'expo_token_1' }, accountId: 'r1', defaultScope: null }),
        accountName: () => 'ramu-bot',
      },
      {
        build: vi.fn(),
        builds: vi.fn(async () => []),
        app: vi.fn(async () => ({ name: 'Barber', page: '' })),
        logs,
      } as never,
      vi.fn(),
      async () => JSON.stringify({ name: 'Barber', extra: { eas: { projectId: APP } } }),
    )
    await service.resolveConfig('p1')
    expect(await service.logs('p1', BUILD, 'build')).toBe('Build failed')
    expect(logs).toHaveBeenCalledWith(expect.anything(), APP, BUILD, 'build', expect.any(Number))
  })
})
