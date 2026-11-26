import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  latestProviderRelease,
  newerVersion,
  parseProviderVersion,
  ProviderService,
  updateFailure,
} from '../src/providers/providers'
import {
  configureProviderAccounts,
  configureProviderBinaries,
  findExecutable,
  providerBinary,
  providerEnvironment,
} from '../src/providers/providerBinaries'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { providerAdapter } from '../src/providers/adapters'
import { ActivityService } from '../src/background/activity'
import * as antigravityInstall from '../src/providers/antigravityInstall'
import { antigravityTarget } from '../src/providers/antigravityRelease'
import type { ProviderStatus } from '@ramu/shared/providers/providers'

let dir: string, bin: string, preferences: AppPreferences, store: Map<string, unknown>, service: ProviderService
const emit = vi.fn()
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu providers '))
  bin = join(dir, 'custom binary')
  configureProviderAccounts(join(dir, 'accounts'))
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs=require('fs');fs.appendFileSync(${JSON.stringify(join(dir, 'calls'))},JSON.stringify({args:process.argv.slice(2),helper:process.env.ANTIGRAVITY_HARNESS_PATH})+'\\n');
if(process.argv.includes('--version')) console.log('custom-cli 1.2.3');
else if(process.argv[2]==='update') process.exit(0);
else require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentInfo:{name:'Antigravity',version:'1.2.3'}}}));});
`,
  )
  chmodSync(bin, 0o755)
  preferences = {
    ...DEFAULT_APP_PREFERENCES,
    // Most tests are about checking and installing; waiting a day has its own tests below.
    updateWait: false,
    providerBinaries: {
      'claude-code': { binary: bin },
      codex: { binary: bin },
      opencode: { binary: bin },
      cursor: { binary: bin },
      antigravity: { binary: bin },
    },
  }
  store = new Map()
  emit.mockClear()
})
afterEach(() => {
  service?.close()
  configureProviderBinaries({})
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})
const create = (activity?: ActivityService) =>
  (service = new ProviderService(
    () => preferences,
    <T>(key: string, fallback: T) => (store.get(key) as T) ?? fallback,
    (key, value) => {
      store.set(key, structuredClone(value))
    },
    emit,
    activity,
  ))
/** Google's CLI manifest for this computer, as its release feed serves it. */
const antigravityManifest = (version: string) => {
  const win = process.platform === 'win32',
    arm = process.arch === 'arm64'
  const os = process.platform === 'darwin' ? 'mac' : win ? 'windows' : 'linux'
  const musl = antigravityTarget()?.endsWith('_musl') ? '_musl' : ''
  const folder = `${win ? 'windows' : process.platform}-${arm ? 'arm' : 'x64'}${musl ? '-musl' : ''}`
  return {
    version,
    url: `https://storage.googleapis.com/antigravity-public/antigravity-cli/${version}-1/${folder}/cli_${os}_${arm ? 'arm64' : 'x64'}${musl}.${win ? 'exe' : 'tar.gz'}`,
    sha512: 'a'.repeat(128),
  }
}
const mockReleases = () => {
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        url.includes('cursor.com')
          ? 'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.10.01-e373342/macos/arm64/agent-cli-package.tar.gz"'
          : url.includes('antigravity')
            ? JSON.stringify(antigravityManifest('1.5.13'))
            : JSON.stringify({ version: url.includes('opencode') ? '1.3.0' : '1.4.0' }),
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
it('compares semantic versions and Cursor date releases without downgrades', () => {
  expect(parseProviderVersion('codex-cli 0.114.0')).toBe('0.114.0')
  expect(parseProviderVersion('agent 2026.10.01-e373342')).toBe('2026.10.01-e373342')
  expect(newerVersion('1.10.0', '1.9.9')).toBe(true)
  expect(newerVersion('1.2.3', '1.2.3-beta.1')).toBe(true)
  expect(newerVersion('1.2.3-beta.10', '1.2.3-beta.9')).toBe(true)
  expect(newerVersion('1.2.3-beta', '1.2.3')).toBe(false)
  expect(newerVersion('1.0.0', '2.0.25')).toBe(false)
  expect(newerVersion('2026.10.01-e373342', '2026.10.02-abc')).toBe(false)
  expect(newerVersion('2026.10.01-e373342', '2026.09.30-abc')).toBe(true)
  expect(newerVersion('2026.10.01-e373342', '2026.10.01-abc')).toBe(true)
  expect(newerVersion('2026.10.01-e373342', '2026.10.01-e373342')).toBe(false)
})
it('custom executable paths override environment and are shared by runners', async () => {
  vi.stubEnv('RAMU_CODEX_BIN', '/missing/env-codex')
  create()
  expect(providerBinary('codex')).toBe(bin)
  expect(findExecutable(dir)).toBe(null)
  const statuses = await service.status()
  expect(statuses.every((s) => s.installed && s.version === '1.2.3' && s.binary === bin)).toBe(true)
  const wire = readFileSync(join(dir, 'calls'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(wire.filter((c) => c.args.includes('--version'))).toHaveLength(4)
  expect(statuses.find((s) => s.provider === 'codex')!.setupCommand).toContain(bin)
})
it('Claude uses the user CLI by default, never the SDK package runtime', () => {
  configureProviderBinaries({})
  expect(providerBinary('claude-code')).not.toContain('node_modules')
  vi.stubEnv('RAMU_CLAUDE_BIN', bin)
  expect(providerBinary('claude-code')).toBe(bin)
})
it('reports missing binaries while preserving configuration and setup help', async () => {
  create()
  const statuses = await service.status({
    ...preferences.providerBinaries,
    cursor: { binary: join(dir, 'not installed') },
  })
  expect(statuses.find((s) => s.provider === 'cursor')).toMatchObject({
    installed: false,
    version: null,
    updateAvailable: false,
    installCommand: expect.stringContaining('cursor.com/install'),
  })
  expect(providerBinary('cursor')).toBe(bin)
})
it('uses official sources, with OpenCode on its v2 package', async () => {
  const network = mockReleases()
  await latestProviderRelease('opencode', '2.0.25')
  expect(network.mock.calls.map((c) => c[0])).toEqual(['https://registry.npmjs.org/%40opencode%2Fcli/latest'])
  expect((await latestProviderRelease('cursor', null)).version).toBe('2026.10.01-e373342')
  expect((await latestProviderRelease('antigravity', null)).version).toBe('1.5.13')
})
it('manual checks still work when automatic checks are disabled and remember dismissal', async () => {
  const network = mockReleases()
  preferences.providerUpdateChecks = false
  create()
  expect(await service.updates()).toEqual([])
  expect(network).not.toHaveBeenCalled()
  const statuses = await service.status(undefined, true)
  expect(statuses.find((s) => s.provider === 'codex')).toMatchObject({ latestVersion: '1.4.0', updateAvailable: true })
  expect(store.has('provider-releases')).toBe(true)
  const codex = statuses.find((s) => s.provider === 'codex')!
  service.dismiss(codex)
  service.close()
  create()
  preferences.providerUpdateChecks = true
  service.settingsChanged()
  expect((await service.updates()).some((s) => s.provider === 'codex')).toBe(false)
  expect((await service.status()).find((s) => s.provider === 'codex')!.updateAvailable).toBe(true)
})
it('returns an actionable error on release lookup failure without losing the installed version', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('offline', { status: 503 })),
  )
  create()
  const statuses = await service.status(undefined, true)
  expect(statuses[0]).toMatchObject({ version: '1.2.3', latestVersion: null, error: expect.stringContaining('503') })
})
describe('automatic checks', () => {
  const update = {
    provider: 'codex',
    binary: '/bin/codex',
    updateAvailable: true,
    latestVersion: '2.0.0',
  } as ProviderStatus
  it('starts enabled by default and stops checking and showing notices when disabled', async () => {
    vi.useFakeTimers()
    create()
    const status = vi.spyOn(service, 'status').mockResolvedValue([update])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(status).toHaveBeenCalledWith(undefined, true, false)
    expect(emit).toHaveBeenLastCalledWith([update])
    preferences.providerUpdateChecks = false
    service.settingsChanged()
    expect(emit).toHaveBeenLastCalledWith([])
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(status).toHaveBeenCalledTimes(1)
  })
  it('does not show an in-flight automatic result after notifications are switched off', async () => {
    vi.useFakeTimers()
    create()
    let finish!: (s: ProviderStatus[]) => void
    vi.spyOn(service, 'status').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await vi.advanceTimersByTimeAsync(30_000)
    preferences.providerUpdateChecks = false
    service.settingsChanged()
    finish([update])
    await Promise.resolve()
    await Promise.resolve()
    expect(emit).toHaveBeenLastCalledWith([])
  })
})

it('isolates supported account login commands and rejects unknown profiles', () => {
  configureProviderAccounts(join(dir, 'accounts'))
  create()
  preferences.providerBinaries.codex = { binary: bin, accountId: 'work', accounts: [{ id: 'work', name: 'Work' }] }
  service.settingsChanged()
  const env = providerEnvironment('codex')
  expect(env.CODEX_HOME).toContain('/codex/work')
  expect(service.loginCommand('codex')).toContain('CODEX_HOME=')
  expect(service.loginCommand('codex')).toContain(bin)
  expect(() => providerEnvironment('codex', preferences.providerBinaries, 'unknown')).toThrow('no longer exists')
  expect(service.loginCommand('antigravity')).toBeNull()
})
it('auto-updates in the daemon even when provider notices are disabled', async () => {
  vi.useFakeTimers()
  preferences.providerUpdateChecks = false
  preferences.providerBinaries.cursor = { binary: bin, autoUpdate: true }
  create()
  const available = { provider: 'cursor', binary: bin, updateAvailable: true, latestVersion: '2.0.0' } as ProviderStatus
  vi.spyOn(service, 'status').mockResolvedValue([available])
  const update = vi.spyOn(service, 'update').mockResolvedValue(available)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(update).toHaveBeenCalledExactlyOnceWith('cursor')
  service.close()
  await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
  expect(update).toHaveBeenCalledOnce()
})
it('refuses to replace a custom Codex binary with an unrelated npm installation', async () => {
  create()
  await expect(service.update('codex')).rejects.toThrow('custom Codex')
})

it('caches and coalesces status probes, expires them, and bypasses the cache for explicit refreshes', async () => {
  const probes = AGENT_PROVIDERS.map((provider) => {
    const adapter = providerAdapter(provider)
    vi.spyOn(adapter, 'signInState').mockResolvedValue({ signedIn: true })
    return vi.spyOn(adapter, 'probeVersion').mockResolvedValue('1.2.3')
  })
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  create()
  const first = service.status()
  expect(service.status()).toBe(first)
  const statuses = await first
  expect(await service.status()).toBe(statuses)
  preferences = { ...preferences, fontSize: preferences.fontSize + 1 }
  service.settingsChanged()
  expect(await service.status()).toBe(statuses)
  probes.forEach((probe) => expect(probe).toHaveBeenCalledOnce())

  clock.mockReturnValue(now + 60_001)
  await service.status()
  probes.forEach((probe) => expect(probe).toHaveBeenCalledTimes(2))
  await service.status(undefined, false, true, true)
  probes.forEach((probe) => expect(probe).toHaveBeenCalledTimes(3))

  preferences.providerBinaries = { ...preferences.providerBinaries, codex: { binary: bin, enabled: false } }
  service.settingsChanged()
  expect((await service.status()).find((status) => status.provider === 'codex')?.enabled).toBe(false)
  probes.forEach((probe) => expect(probe).toHaveBeenCalledTimes(4))
})

it('does not substitute an automatic release check for cached login status', async () => {
  for (const provider of AGENT_PROVIDERS) {
    vi.spyOn(providerAdapter(provider), 'signInState').mockResolvedValue({ signedIn: true })
    vi.spyOn(providerAdapter(provider), 'probeVersion').mockResolvedValue('1.2.3')
  }
  mockReleases()
  create()
  const statuses = await service.status()
  expect((await service.status(undefined, true, false))[0]?.signIn).toBeUndefined()
  expect(await service.status()).toBe(statuses)
  expect(statuses[0]?.signIn?.default?.signedIn).toBe(true)
})

it('routes managed runtime cancellation to the installer and lets the update be retried', async () => {
  const activity = new ActivityService(() => {})
  preferences.providerBinaries.antigravity = { binary: '' }
  // No agy of this computer's may be found, or Update would run its own updater instead of Ramu's installer.
  vi.stubEnv('HOME', dir)
  vi.stubEnv('PATH', dirname(process.execPath))
  const install = vi.spyOn(antigravityInstall, 'installAntigravity').mockImplementation(async ({ signal } = {}) => {
    await new Promise<void>((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
    )
    return { version: '1.5.0', installed: true }
  })
  create(activity)
  const work = service.update('antigravity')
  expect(service.update('antigravity')).toBe(work)
  const item = activity.status()[0]!
  expect(item).toMatchObject({ label: 'Updating CLI', detail: 'antigravity', cancellable: true })
  activity.cancel(item.id)
  await expect(work).rejects.toThrow('CLI update cancelled.')
  expect(activity.status()).toEqual([])
  install.mockResolvedValue({ version: '1.5.0', installed: true })
  const status = { provider: 'antigravity', binary: bin } as ProviderStatus
  vi.spyOn(service, 'status').mockResolvedValue([status])
  await expect(service.update('antigravity')).resolves.toEqual(status)
  expect(install).toHaveBeenCalledTimes(2)
})
it('reads one provider and its logins without probing the others', async () => {
  const probes = AGENT_PROVIDERS.map((provider) => {
    const adapter = providerAdapter(provider)
    vi.spyOn(adapter, 'signInState').mockResolvedValue({ signedIn: true })
    return [provider, vi.spyOn(adapter, 'probeVersion').mockResolvedValue('1.2.3')] as const
  })
  create()
  const status = await service.statusOf('codex', {
    ...preferences.providerBinaries,
    codex: { binary: bin, accounts: [{ id: 'work' }] },
  })
  expect(status).toMatchObject({ provider: 'codex', installed: true, version: '1.2.3' })
  expect(Object.keys(status.signIn ?? {}).sort()).toEqual(['default', 'work'])
  for (const [provider, probe] of probes) expect(probe).toHaveBeenCalledTimes(provider === 'codex' ? 1 : 0)
})

describe('waiting a day before an update is offered', () => {
  const calls = () =>
    (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { args: string[] })
  it('names a release seen less than a day ago instead of offering it, and offers it once it has waited', async () => {
    mockReleases()
    preferences = { ...preferences, updateWait: true }
    create()
    const fresh = (await service.status(undefined, true)).find((s) => s.provider === 'claude-code')!
    expect(fresh).toMatchObject({ updateAvailable: false, waitingVersion: '1.4.0', latestVersion: '1.2.3' })
    expect(Date.parse(fresh.waitingUntil!)).toBeGreaterThan(Date.now() + 23 * 3_600_000)
    // The same release, seen two days ago.
    service.close()
    store.set('provider-versions-seen', {
      'claude-code': { '1.4.0': new Date(Date.now() - 2 * 86_400_000).toISOString() },
    })
    create()
    const settled = (await service.status(undefined, true)).find((s) => s.provider === 'claude-code')!
    expect(settled).toMatchObject({ updateAvailable: true, latestVersion: '1.4.0' })
    expect(settled.waitingVersion).toBeUndefined()
  })
  it('holds a self-updating CLI while its newest release waits, and installs it at once when asked', async () => {
    mockReleases()
    preferences = { ...preferences, updateWait: true }
    create()
    await expect(service.update('claude-code')).rejects.toThrow('less than a day ago')
    expect(calls().some((call) => call.args[0] === 'update')).toBe(false)
    await service.update('claude-code', true)
    expect(calls().some((call) => call.args[0] === 'update')).toBe(true)
  })
  it('does not hold a first install for the wait, which only protects a working install', async () => {
    mockReleases()
    preferences = { ...preferences, updateWait: true }
    preferences.providerBinaries.antigravity = { binary: '' }
    create()
    // Pointing the runtime at a missing file is how this test makes Antigravity not installed; Ramu then refuses only
    // because that path is a custom one, past the point where the wait would have stopped it.
    vi.stubEnv('RAMU_ANTIGRAVITY_BIN', join(dir, 'not-installed', 'antigravity'))
    await expect(service.update('antigravity')).rejects.toThrow('custom Antigravity runtime')
    vi.stubEnv('RAMU_ANTIGRAVITY_BIN', bin)
    await expect(service.update('antigravity')).rejects.toThrow('less than a day ago')
    vi.unstubAllEnvs()
  })
  it("pins Ramu's own Codex copy to the exact release that has waited, with node on the updater's PATH", () => {
    const codex = providerAdapter('codex')
    const plan = codex.updatePlan({
      config: {},
      binary: '/tmp/runtime/node_modules/.bin/codex',
      findExecutable: (command) => (command.startsWith('/') ? command : `/fnm/default/bin/${command}`),
      runtimeHome: '/tmp/runtime',
      installRuntime: async () => {},
      version: '1.3.0',
    })
    expect(plan).toMatchObject({ command: '/fnm/default/bin/npm', pathDirs: ['/fnm/default/bin'] })
    expect('args' in plan && plan.args.at(-1)).toBe('@openai/codex@1.3.0')
    expect(
      typeof codex.pinsVersion === 'function' &&
        codex.pinsVersion('/tmp/runtime/node_modules/.bin/codex', '/tmp/runtime'),
    ).toBe(true)
  })
  it('lets a Codex you installed update itself, with or without npm', () => {
    const codex = providerAdapter('codex')
    const plan = codex.updatePlan({
      config: {},
      binary: 'codex',
      findExecutable: (command) => (command === 'codex' ? '/Users/me/.local/bin/codex' : null),
      runtimeHome: '/tmp/runtime',
      installRuntime: async () => {},
      version: '1.3.0',
    })
    expect(plan).toEqual({
      command: '/Users/me/.local/bin/codex',
      args: ['update'],
      pathDirs: ['/Users/me/.local/bin'],
    })
    // `codex update` takes only the newest release, so Ramu waits out the day before offering it.
    expect(
      typeof codex.pinsVersion === 'function' && codex.pinsVersion('/Users/me/.local/bin/codex', '/tmp/runtime'),
    ).toBe(false)
  })
  it("says why Ramu's own Codex copy cannot update without npm", () => {
    expect(() =>
      providerAdapter('codex').updatePlan({
        config: {},
        binary: '/tmp/runtime/node_modules/.bin/codex',
        findExecutable: (command) => (command.startsWith('/') ? command : null),
        runtimeHome: '/tmp/runtime',
        installRuntime: async () => {},
      }),
    ).toThrow('npm was not found')
  })
})

it("reports an updater's own reason for failing", () => {
  expect(updateFailure('/usr/bin/npm', { code: 'ENOENT' }, '', '')).toBe('CLI update failed: npm was not found.')
  expect(
    updateFailure('npm', { code: 1 }, '\u001b[31mnpm error\u001b[0m code EACCES\nnpm error permission denied\n', ''),
  ).toBe(
    'CLI update failed: Ramu could not write where this CLI is installed. Run the update command in a terminal, or reinstall the CLI in a folder you own. (npm error code EACCES npm error permission denied)',
  )
  expect(
    updateFailure('npm', { code: 1 }, 'npm error code ENOTFOUND\nnpm error request to registry failed', ''),
  ).toMatch(/^CLI update failed: The download server could not be reached\./)
  expect(updateFailure('npm', { code: 1 }, 'npm error code E404\nnot found', '')).toBe(
    'CLI update failed: npm error code E404 not found',
  )
  expect(updateFailure('codex', { killed: true }, '', '')).toContain('longer than 5 minutes')
  expect(updateFailure('codex', { code: 1 }, '', '')).toContain('Check permissions')
})
