import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { latestProviderRelease, newerVersion, parseProviderVersion, ProviderService } from '../src/providers/providers'
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
else require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentInfo:{name:'Antigravity',version:'1.2.3'}}}));});
`,
  )
  chmodSync(bin, 0o755)
  preferences = {
    ...DEFAULT_APP_PREFERENCES,
    providerBinaries: {
      'claude-code': { binary: bin },
      codex: { binary: bin },
      opencode: { binary: bin },
      cursor: { binary: bin },
      antigravity: { binary: bin, harness: join(dir, 'helper') },
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
const mockReleases = () => {
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        url.includes('cursor.com')
          ? 'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.10.01-e373342/macos/arm64/agent-cli-package.tar.gz"'
          : url.includes('antigravity')
            ? JSON.stringify({
                version: '1.3.0',
                distribution: { binary: { 'darwin-aarch64': { archive: 'https://dl.google.com/runtime.zip' } } },
              })
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
  expect(providerEnvironment('antigravity').ANTIGRAVITY_HARNESS_PATH).toBe(join(dir, 'helper'))
  const statuses = await service.status()
  expect(statuses.every((s) => s.installed && s.version === '1.2.3' && s.binary === bin)).toBe(true)
  const wire = readFileSync(join(dir, 'calls'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(wire.filter((c) => c.args.includes('--version'))).toHaveLength(4)
  // Every provider shares the fake binary and probes in parallel; only Antigravity's calls carry its helper.
  expect(wire.some((c) => c.helper === join(dir, 'helper'))).toBe(true)
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
  expect((await latestProviderRelease('antigravity', null)).version).toBe('1.3.0')
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
