import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  downloadResumable,
  installAntigravity,
  probeAntigravity,
  resolveAntigravityAsset,
  type AntigravityAsset,
} from '../src/providers/antigravityInstall'
import { antigravityTarget } from '../src/providers/antigravityRelease'
import {
  configureProviderAccounts,
  managedAntigravity,
  providerBinary,
  providerEnvironment,
  providerRuntimeHome,
} from '../src/providers/providerBinaries'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-agy-'))
  configureProviderAccounts(join(root, 'provider-accounts'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const google = 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.13-5999302598852608'
const manifest = (file: string) => ({ version: '1.5.13', url: `${google}/${file}`, sha512: 'A'.repeat(128) })

it("names Google's manifest for each platform, including musl Linux", () => {
  expect(antigravityTarget('darwin', 'arm64')).toBe('darwin_arm64')
  expect(antigravityTarget('linux', 'x64', true)).toBe('linux_amd64_musl')
  expect(antigravityTarget('win32', 'x64')).toBe('windows_amd64')
  expect(antigravityTarget('freebsd', 'x64')).toBeNull()
  expect(antigravityTarget('linux', 'ia32')).toBeNull()
})

it("trusts only Google's download folder, the platform's own file, plain versions and a SHA-512", () => {
  expect(resolveAntigravityAsset(manifest('darwin-arm/cli_mac_arm64.tar.gz'), 'darwin', 'arm64', false)).toEqual({
    version: '1.5.13',
    url: `${google}/darwin-arm/cli_mac_arm64.tar.gz`,
    sha512: 'a'.repeat(128),
    format: 'tar.gz',
  })
  expect(resolveAntigravityAsset(manifest('windows-x64/cli_windows_x64.exe'), 'win32', 'x64')?.format).toBe(
    'executable',
  )
  expect(
    resolveAntigravityAsset(manifest('linux-x64-musl/cli_linux_x64_musl.tar.gz'), 'linux', 'x64', true),
  ).not.toBeNull()
  // Another platform's build, another host, a path outside the release, a bad version or no checksum are all refused.
  expect(resolveAntigravityAsset(manifest('linux-x64/cli_linux_x64.tar.gz'), 'darwin', 'arm64', false)).toBeNull()
  expect(
    resolveAntigravityAsset(
      {
        ...manifest('x'),
        url: 'https://evil.example/antigravity-public/antigravity-cli/1.5.13-1/darwin-arm/cli_mac_arm64.tar.gz',
      },
      'darwin',
      'arm64',
      false,
    ),
  ).toBeNull()
  expect(resolveAntigravityAsset(manifest('../darwin-arm/cli_mac_arm64.tar.gz'), 'darwin', 'arm64', false)).toBeNull()
  expect(
    resolveAntigravityAsset(
      { ...manifest('darwin-arm/cli_mac_arm64.tar.gz'), version: '../1.5' },
      'darwin',
      'arm64',
      false,
    ),
  ).toBeNull()
  expect(
    resolveAntigravityAsset(
      { ...manifest('darwin-arm/cli_mac_arm64.tar.gz'), sha512: undefined },
      'darwin',
      'arm64',
      false,
    ),
  ).toBeNull()
})

const unix = process.platform !== 'win32'
/** A release archive holding the given files, and the asset that names it with its real checksum. */
function release(version: string, names = ['antigravity']): { asset: AntigravityAsset; download: () => Promise<void> } {
  const dir = mkdtempSync(join(root, 'tar-'))
  for (const name of names) {
    writeFileSync(join(dir, name), '#!/bin/sh\n')
    chmodSync(join(dir, name), 0o755)
  }
  const archive = join(root, `${version}-${names.length}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', dir, ...names])
  const sha512 = createHash('sha512').update(readFileSync(archive)).digest('hex')
  return {
    asset: { version, url: `${google}/x.tar.gz`, sha512, format: 'tar.gz' },
    download: async (_url?: string, file?: string) => writeFileSync(file!, readFileSync(archive)),
  } as never
}

it.skipIf(!unix)("installs the CLI into Ramu's own directory, activates it and launches it as `agy acp`", async () => {
  const { asset, download } = release('1.5.13')
  const probed: string[] = []
  expect(managedAntigravity()).toBeNull()
  const result = await installAntigravity({
    asset,
    download,
    probe: async (exe, version) => void probed.push(exe, version),
  })
  expect(result).toEqual({ version: '1.5.13', installed: true })
  expect(probed[1]).toBe('1.5.13')
  const runtime = managedAntigravity()!
  expect(runtime).toEqual({
    executable: join(providerRuntimeHome('antigravity'), 'versions', '1.5.13', 'agy'),
    version: '1.5.13',
  })
  expect(providerBinary('antigravity', {})).toBe(runtime.executable)
  expect(providerEnvironment('antigravity', {})).toMatchObject({ AGY_CLI_DISABLE_AUTO_UPDATE: '1' })
  expect(readdirSync(providerRuntimeHome('antigravity')).filter((entry) => entry.startsWith('.stage-'))).toEqual([])
  // The finished download is not kept, and the same version is not downloaded again.
  expect(readdirSync(join(providerRuntimeHome('antigravity'), 'downloads'))).toEqual([])
  expect(
    await installAntigravity({
      asset,
      download: async () => {
        throw new Error('should not download')
      },
    }),
  ).toEqual({ version: '1.5.13', installed: false })
})

it.skipIf(!unix)('replaces the older runtime Ramu downloaded, which keeps running until then', async () => {
  const home = providerRuntimeHome('antigravity'),
    old = join(home, 'versions', '1.4.3')
  mkdirSync(old, { recursive: true })
  for (const name of ['agy_acp_server.par', 'localharness_external']) writeFileSync(join(old, name), '#!/bin/sh\n')
  writeFileSync(join(home, 'active.json'), JSON.stringify({ version: '1.4.3' }))
  expect(managedAntigravity()).toMatchObject({ version: '1.4.3', harness: join(old, 'localharness_external') })
  expect(providerEnvironment('antigravity', {}).ANTIGRAVITY_HARNESS_PATH).toBe(join(old, 'localharness_external'))
  const { asset, download } = release('1.5.13')
  await installAntigravity({ asset, download, probe: async () => {} })
  expect(managedAntigravity()).toEqual({ executable: join(home, 'versions', '1.5.13', 'agy'), version: '1.5.13' })
  expect(providerEnvironment('antigravity', {}).ANTIGRAVITY_HARNESS_PATH).toBeUndefined()
})

it.skipIf(!unix)('keeps one previous version for rollback and drops older ones', async () => {
  for (const version of ['1.5.1', '1.5.2', '1.5.3']) {
    const { asset, download } = release(version)
    await installAntigravity({ asset, download, probe: async () => {} })
  }
  expect(readdirSync(join(providerRuntimeHome('antigravity'), 'versions')).sort()).toEqual(['1.5.2', '1.5.3'])
  expect(managedAntigravity()?.version).toBe('1.5.3')
})

it.skipIf(!unix)('never activates an archive with anything else in it, or a CLI that fails its handshake', async () => {
  const two = release('1.5.13', ['antigravity', 'extra'])
  await expect(installAntigravity({ ...two, probe: async () => {} })).rejects.toThrow('one executable')
  const one = release('1.5.13')
  await expect(
    installAntigravity({
      ...one,
      probe: async () => {
        throw new Error('The downloaded CLI did not answer.')
      },
    }),
  ).rejects.toThrow('did not answer')
  expect(managedAntigravity()).toBeNull()
  expect(existsSync(join(providerRuntimeHome('antigravity'), 'versions', '1.5.13'))).toBe(false)
  expect(readdirSync(providerRuntimeHome('antigravity')).filter((entry) => entry.startsWith('.stage-'))).toEqual([])
})

it.skipIf(!unix)('never unpacks a download whose checksum differs, and does not keep it', async () => {
  const { asset, download } = release('1.5.13')
  await expect(
    installAntigravity({ asset: { ...asset, sha512: '0'.repeat(128) }, download, probe: async () => {} }),
  ).rejects.toThrow('checksum')
  expect(managedAntigravity()).toBeNull()
  expect(readdirSync(join(providerRuntimeHome('antigravity'), 'downloads'))).toEqual([])
})

it.skipIf(!unix)(
  'says how long it waited and what the CLI last printed when it never answers or stops early',
  async () => {
    const silent = join(root, 'agy'),
      quits = join(root, 'quits', 'agy')
    mkdirSync(join(root, 'quits'))
    writeFileSync(silent, '#!/bin/sh\necho "starting language server" >&2\nsleep 5\n')
    writeFileSync(quits, '#!/bin/sh\necho "illegal instruction" >&2\nexit 1\n')
    chmodSync(silent, 0o755)
    chmodSync(quits, 0o755)
    await expect(probeAntigravity(silent, '1.5.13', 2000)).rejects.toThrow(
      /did not answer within 2 seconds.*Last output: starting language server/,
    )
    await expect(probeAntigravity(quits, '1.5.13', 5000)).rejects.toThrow(
      /stopped before answering.*Last output: illegal instruction/,
    )
  },
)

/** Serves `body`, honoring Range requests, and drops the first response after `cut` bytes. */
async function flakyServer(body: Buffer, cut: number): Promise<{ server: Server; url: string; ranges: string[] }> {
  const ranges: string[] = []
  let first = true
  const server = createServer((request, response) => {
    const range = request.headers.range ?? ''
    ranges.push(range)
    const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0)
    response.writeHead(start ? 206 : 200, { 'Content-Length': body.length - start })
    if (first) {
      first = false
      response.write(body.subarray(0, cut))
      setTimeout(() => response.destroy(), 20)
      return
    }
    response.end(body.subarray(start))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cli.tar.gz`, ranges }
}

it('resumes a dropped download from where it stopped instead of starting over', async () => {
  const body = Buffer.alloc(200_000, 7)
  const { server, url, ranges } = await flakyServer(body, 50_000)
  try {
    const file = join(root, 'cli.part')
    await downloadResumable(url, file, undefined, { retryDelayMs: 1 })
    expect(readFileSync(file).equals(body)).toBe(true)
    expect(ranges[0]).toBe('')
    expect(ranges[1]).toMatch(/^bytes=\d+-$/)
    expect(Number(/\d+/.exec(ranges[1]!)![0])).toBeGreaterThan(0)
  } finally {
    server.close()
  }
})

it('drops a stalled connection and continues on a new one', async () => {
  const body = Buffer.alloc(10_000, 3)
  let calls = 0
  const server = createServer((request, response) => {
    calls++
    const start = Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? '')?.[1] ?? 0)
    response.writeHead(start ? 206 : 200, { 'Content-Length': body.length - start })
    // The first connection sends a little, then goes silent.
    if (calls === 1) response.write(body.subarray(0, 1000))
    else response.end(body.subarray(start))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const file = join(root, 'cli.part')
    await downloadResumable(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, file, undefined, {
      stallMs: 200,
      retryDelayMs: 1,
    })
    expect(readFileSync(file).equals(body)).toBe(true)
    expect(calls).toBe(2)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

it.skipIf(process.env.RAMU_LIVE_INSTALL !== '1')(
  "installs Google's real CLI and it answers the ACP handshake",
  async () => {
    const result = await installAntigravity()
    expect(result.installed).toBe(true)
    expect(managedAntigravity()?.version).toBe(result.version)
  },
  15 * 60_000,
)

const asset: AntigravityAsset = {
  version: '1.5.13',
  url: `${google}/x.tar.gz`,
  sha512: 'a'.repeat(128),
  format: 'tar.gz',
}

it('rejects an already cancelled install without downloading or creating files', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(installAntigravity({ asset, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(managedAntigravity()).toBeNull()
  expect(existsSync(providerRuntimeHome('antigravity'))).toBe(false)
})

it('cancels an in-progress download and keeps what arrived for the next attempt', async () => {
  const controller = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const work = installAntigravity({
    asset,
    signal: controller.signal,
    download: async (_url, file, signal) => {
      writeFileSync(file, 'partial download')
      started()
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      )
    },
  })
  await ready
  controller.abort()
  await expect(work).rejects.toMatchObject({ name: 'AbortError' })
  expect(managedAntigravity()).toBeNull()
  expect(readdirSync(join(providerRuntimeHome('antigravity'), 'downloads'))).toEqual([`1.5.13-${'a'.repeat(16)}.part`])
  expect(readdirSync(providerRuntimeHome('antigravity')).filter((entry) => entry.startsWith('.stage-'))).toEqual([])
})

it.skipIf(!unix)('preserves the active CLI when cancelled before activation', async () => {
  const first = release('1.5.12')
  await installAntigravity({ ...first, probe: async () => {} })
  const controller = new AbortController()
  const next = release('1.5.13')
  await expect(
    installAntigravity({
      ...next,
      signal: controller.signal,
      probe: async () => {
        controller.abort()
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(managedAntigravity()?.version).toBe('1.5.12')
  expect(readdirSync(join(providerRuntimeHome('antigravity'), 'versions'))).toEqual(['1.5.12'])
  expect(readdirSync(providerRuntimeHome('antigravity')).filter((entry) => entry.startsWith('.stage-'))).toEqual([])
})
