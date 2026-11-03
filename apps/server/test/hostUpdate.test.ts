import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppUpdateStatus } from '@ramu/shared/updates'
import { HostUpdater, isSupervised, sourceCheckout, type HostUpdateDeps } from '../src/background/hostUpdate'

const release = {
  version: '0.2.0',
  notesUrl: 'https://github.com/ahxar/ramu/releases/tag/v0.2.0',
  publishedAt: '',
  assetUrl: '',
  assetName: 'a.zip',
  size: 1,
  checksumsUrl: '',
}
const status = (patch: Partial<AppUpdateStatus> = {}): AppUpdateStatus => ({
  currentVersion: '0.1.0',
  phase: 'available',
  release,
  checkedAt: null,
  error: null,
  downloadedBytes: 0,
  ...patch,
})

function deps(patch: Partial<HostUpdateDeps> = {}) {
  const commands: string[] = []
  const value: HostUpdateDeps = {
    status: async () => status(),
    check: async () => status(),
    download: async () => status({ phase: 'ready' }),
    desktopAttached: () => false,
    installOnDesktop: vi.fn(async () => {}),
    sourceRoot: null,
    run: async (command, args) => {
      commands.push([command, ...args].join(' '))
      return command === 'git' && args[0] === 'rev-parse' ? 'abc123\n' : ''
    },
    supervised: false,
    ...patch,
  }
  return { value, commands }
}

describe('updating Ramu on a host from another device', () => {
  it('says a host is current without touching anything', async () => {
    const { value, commands } = deps({
      status: async () => status({ release: null }),
      check: async () => status({ release: null }),
    })
    expect((await new HostUpdater(value).apply()).result).toMatchObject({ outcome: 'current', version: '0.1.0' })
    expect(commands).toEqual([])
  })

  it('hands the install to the open desktop app once the release is downloaded', async () => {
    const download = vi.fn(async () => status({ phase: 'ready' }))
    const { value } = deps({ desktopAttached: () => true, download })
    const run = await new HostUpdater(value).apply()
    expect(download).toHaveBeenCalledOnce()
    expect(value.installOnDesktop).toHaveBeenCalledWith('0.2.0')
    expect(run).toEqual({ result: expect.objectContaining({ outcome: 'restarting' }), restartService: false })
  })

  it('rebuilds a headless checkout on the release tag and restarts it only under a service manager', async () => {
    const supervisedRun = deps({ sourceRoot: '/opt/ramu', supervised: true })
    expect(await new HostUpdater(supervisedRun.value).apply()).toMatchObject({
      result: { outcome: 'restarting', version: '0.2.0' },
      restartService: true,
    })
    expect(supervisedRun.commands).toEqual([
      'git status --porcelain --untracked-files=no',
      'git rev-parse HEAD',
      'git fetch --tags --quiet origin refs/tags/v0.2.0:refs/tags/v0.2.0',
      'git checkout --quiet --detach v0.2.0',
      'pnpm install --frozen-lockfile',
      'pnpm build',
    ])
    const alone = deps({ sourceRoot: '/opt/ramu', supervised: false })
    expect(await new HostUpdater(alone.value).apply()).toMatchObject({
      result: { outcome: 'built' },
      restartService: false,
    })
  })

  it('leaves a checkout with local changes as it is', async () => {
    const { value, commands } = deps({
      sourceRoot: '/opt/ramu',
      run: async (command, args) => {
        commands.push([command, ...args].join(' '))
        return args[0] === 'status' ? ' M apps/server/src/index.ts\n' : ''
      },
    })
    expect((await new HostUpdater(value).apply()).result).toMatchObject({ outcome: 'unavailable' })
    expect(commands).toEqual(['git status --porcelain --untracked-files=no'])
  })

  it('puts a failed build back on the version that ran, and does not retry that release from afar', async () => {
    const { value, commands } = deps({ sourceRoot: '/opt/ramu', supervised: true })
    const run = value.run
    value.run = async (command, args, cwd) => {
      if (
        command === 'pnpm' &&
        args[0] === 'build' &&
        commands.includes('git checkout --quiet --detach v0.2.0') &&
        !commands.includes('git checkout --quiet --detach abc123')
      ) {
        commands.push('pnpm build')
        throw new Error('pnpm build failed: type error')
      }
      return run(command, args, cwd)
    }
    const updater = new HostUpdater(value)
    await expect(updater.apply()).rejects.toThrow(/did not build on this host, so it keeps the version it runs/)
    expect(commands.slice(-3)).toEqual([
      'git checkout --quiet --detach abc123',
      'pnpm install --frozen-lockfile',
      'pnpm build',
    ])
    expect((await updater.apply()).result).toMatchObject({ outcome: 'unavailable', notesUrl: release.notesUrl })
  })

  it('tells a packaged host without its app open to install the release itself, and runs one update at a time', async () => {
    const { value } = deps()
    expect((await new HostUpdater(value).apply()).result).toMatchObject({
      outcome: 'unavailable',
      notesUrl: release.notesUrl,
    })
    let finish!: () => void
    const slow = deps({
      desktopAttached: () => true,
      installOnDesktop: () => new Promise<void>((resolve) => (finish = resolve)),
    })
    const updater = new HostUpdater(slow.value)
    const first = updater.apply()
    await vi.waitFor(() => expect(finish).toBeDefined())
    await expect(updater.apply()).rejects.toThrow(/already running/)
    finish()
    await first
  })
})

it('finds the checkout a server was built from, and knows when a service manager restarts it', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-checkout-'))
  try {
    mkdirSync(join(root, 'apps', 'server', 'dist'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ramu-monorepo' }))
    expect(sourceCheckout(join(root, 'apps', 'server', 'dist'))).toBeNull()
    mkdirSync(join(root, '.git'))
    expect(sourceCheckout(join(root, 'apps', 'server', 'dist'))).toBe(join(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  expect(isSupervised({ INVOCATION_ID: 'x' })).toBe(true)
  expect(isSupervised({ XPC_SERVICE_NAME: 'app.ramu.server' })).toBe(true)
  expect(isSupervised({ XPC_SERVICE_NAME: '0' })).toBe(false)
  expect(isSupervised({ RAMU_SUPERVISED: '1' })).toBe(true)
  expect(isSupervised({})).toBe(false)
})
