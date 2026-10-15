import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installAntigravity, resolveAntigravityAsset } from '../src/antigravityInstall'
import { antigravityFileNames, configureProviderAccounts, managedAntigravity, providerBinary, providerEnvironment, providerRuntimeHome } from '../src/providerBinaries'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ramu-agy-')); configureProviderAccounts(join(root, 'provider-accounts')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const registry = { version: '1.4.0', distribution: { binary: {
  'darwin-aarch64': { archive: 'https://dl.google.com/agy/mac-arm64.zip' }, 'linux-x86_64': { archive: 'https://dl.google.com/agy/linux-x64.zip' },
  'windows-x86_64': { archive: 'https://dl.google.com/agy/win-x64.zip' }, 'linux-aarch64': { archive: 'https://evil.example/agy.zip' } } } }

it('picks the archive for this platform and trusts only Google downloads and plain versions', () => {
  expect(resolveAntigravityAsset(registry, 'darwin', 'arm64')).toEqual({ version: '1.4.0', archive: 'https://dl.google.com/agy/mac-arm64.zip' })
  expect(resolveAntigravityAsset(registry, 'linux', 'x64')?.archive).toContain('linux-x64')
  expect(resolveAntigravityAsset(registry, 'win32', 'x64')?.archive).toContain('win-x64')
  expect(resolveAntigravityAsset(registry, 'linux', 'arm64')).toBeNull()
  expect(resolveAntigravityAsset(registry, 'darwin', 'x64')).toBeNull()
  expect(resolveAntigravityAsset({ ...registry, version: '../1.4.0' }, 'darwin', 'arm64')).toBeNull()
})

const fakeArchive = (names: string[]) => async (_url: string, file: string) => {
  const dir = mkdtempSync(join(root, 'zip-')); for (const name of names) writeFileSync(join(dir, name), '#!/bin/sh\n')
  execFileSync('zip', ['-q', '-j', file, ...names.map((name) => join(dir, name))])
}
const asset = { version: '1.4.0', archive: 'https://dl.google.com/agy/x.zip' }
const hasZip = (() => { try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); return process.platform !== 'win32' } catch { return false } })()

it.skipIf(!hasZip)('installs into Ramu\'s own directory, activates it, and the runtime resolves with its helper', async () => {
  const names = antigravityFileNames(), probed: string[] = []
  expect(managedAntigravity()).toBeNull()
  const result = await installAntigravity({ asset, download: fakeArchive([names.executable, names.harness]), probe: async (exe, harness) => { probed.push(exe, harness) } })
  expect(result).toEqual({ version: '1.4.0', installed: true })
  expect(probed[0]).not.toContain('versions')
  const runtime = managedAntigravity()!
  expect(runtime.executable).toBe(join(providerRuntimeHome('antigravity'), 'versions', '1.4.0', names.executable))
  expect(providerBinary('antigravity', {})).toBe(runtime.executable)
  expect(providerEnvironment('antigravity', {}).ANTIGRAVITY_HARNESS_PATH).toBe(runtime.harness)
  expect(readdirSync(providerRuntimeHome('antigravity')).filter((entry) => entry.startsWith('.stage-'))).toEqual([])
  // The same version is not downloaded again.
  expect(await installAntigravity({ asset, download: async () => { throw new Error('should not download') } })).toEqual({ version: '1.4.0', installed: false })
})
it.skipIf(!hasZip)('keeps one previous version for rollback and drops older ones', async () => {
  const names = antigravityFileNames(), files = fakeArchive([names.executable, names.harness]), probe = async () => {}
  for (const version of ['1.1.0', '1.2.0', '1.3.0']) await installAntigravity({ asset: { ...asset, version }, download: files, probe })
  expect(readdirSync(join(providerRuntimeHome('antigravity'), 'versions')).sort()).toEqual(['1.2.0', '1.3.0'])
  expect(managedAntigravity()?.version).toBe('1.3.0')
})
it.skipIf(!hasZip)('never activates an archive that is incomplete or fails its handshake', async () => {
  const names = antigravityFileNames()
  await expect(installAntigravity({ asset, download: fakeArchive([names.executable]), probe: async () => {} })).rejects.toThrow('missing')
  await expect(installAntigravity({ asset, download: fakeArchive([names.executable, names.harness]), probe: async () => { throw new Error('The downloaded runtime did not answer.') } })).rejects.toThrow('did not answer')
  expect(managedAntigravity()).toBeNull()
  expect(existsSync(join(providerRuntimeHome('antigravity'), 'versions', '1.4.0'))).toBe(false)
  expect(readdirSync(providerRuntimeHome('antigravity')).filter((entry) => entry.startsWith('.stage-'))).toEqual([])
})
it.skipIf(process.env.RAMU_LIVE_INSTALL !== '1')('installs Google\'s real runtime and it answers the ACP handshake', async () => {
  const result = await installAntigravity()
  expect(result.installed).toBe(true)
  expect(managedAntigravity()?.version).toBe(result.version)
}, 15 * 60_000)
