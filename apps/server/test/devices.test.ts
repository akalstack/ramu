import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, type NetworkInterfaceInfo, type networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { DeviceStore, PAIRING_TTL_MS } from '../src/remote/devices'
import { candidateUrls } from '../src/remote/network'

const dirs: string[] = []
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu devices '))
  dirs.push(dir)
  const path = join(dir, 'remote-devices.json')
  return { path, devices: new DeviceStore(path) }
}

it('pairs a device with a one-time code and recognises its token', () => {
  const { devices } = store()
  const { code } = devices.createCode()
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  const paired = devices.redeem(code, ' Phone ')!
  expect(paired.token).toMatch(/^[a-f0-9]{64}$/)
  expect(paired.device.name).toBe('Phone')
  expect(devices.authenticate(`Bearer ${paired.token}`)?.id).toBe(paired.device.id)
  expect(devices.authenticate(`Bearer ${'0'.repeat(64)}`)).toBeNull()
  expect(devices.authenticate(paired.token)).toBeNull()
  expect(devices.authenticate(undefined)).toBeNull()
})

it('spends a code once and accepts it typed loosely', () => {
  const { devices } = store()
  const { code } = devices.createCode()
  expect(devices.redeem(code.toLowerCase().replace('-', ' '), 'a')).not.toBeNull()
  expect(devices.redeem(code, 'b')).toBeNull()
  expect(devices.list()).toHaveLength(1)
})

it('rejects wrong and expired codes', () => {
  const { devices } = store()
  const { code } = devices.createCode(1000)
  expect(devices.redeem('AAAAA-AAAAA', 'x', 1000)).toBeNull()
  expect(devices.redeem(code, 'x', 1000 + PAIRING_TTL_MS + 1)).toBeNull()
  expect(devices.list()).toEqual([])
})

it('keeps only the five newest pending codes', () => {
  const { devices } = store()
  const codes = Array.from({ length: 6 }, () => devices.createCode().code)
  expect(devices.redeem(codes[0]!, 'old')).toBeNull()
  expect(devices.redeem(codes[5]!, 'new')).not.toBeNull()
})

it('revokes one device without a restart and leaves the others working', () => {
  const { devices } = store()
  const a = devices.redeem(devices.createCode().code, 'a')!,
    b = devices.redeem(devices.createCode().code, 'b')!
  // A second store on the same file stands in for the CLI running beside the server.
  const cli = new DeviceStore((devices as unknown as { path: string }).path)
  expect(cli.revoke(a.device.id.slice(0, 4)).map((d) => d.name)).toEqual(['a'])
  expect(devices.authenticate(`Bearer ${a.token}`)).toBeNull()
  expect(devices.authenticate(`Bearer ${b.token}`)).not.toBeNull()
  expect(cli.revoke('all')).toHaveLength(1)
  expect(devices.authenticate(`Bearer ${b.token}`)).toBeNull()
  expect(cli.revoke('missing')).toEqual([])
  expect(() => cli.revoke('')).toThrow()
})

it('stores hashes in a private file, never the token or code', () => {
  const { path, devices } = store()
  const { code } = devices.createCode()
  const paired = devices.redeem(code, 'x')!
  devices.createCode()
  expect(statSync(path).mode & 0o777).toBe(0o600)
  const text = readFileSync(path, 'utf8')
  expect(text).not.toContain(paired.token)
  expect(text).not.toContain(code.replace('-', ''))
})

it('tolerates a corrupt device file', () => {
  const { path, devices } = store()
  devices.createCode()
  writeFileSync(path, '{nope')
  expect(devices.list()).toEqual([])
  expect(devices.createCode().code).toBeTruthy()
})

it('lists reachable addresses from any interface, VPN or not', () => {
  const info = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
    ({ address, family, internal, netmask: '', mac: '', cidr: null, scopeid: 0 }) as NetworkInterfaceInfo
  const interfaces: ReturnType<typeof networkInterfaces> = {
    lo0: [info('127.0.0.1', 'IPv4', true)],
    en0: [info('192.168.1.5', 'IPv4'), info('fe80::1', 'IPv6')],
    wt0: [info('100.64.0.7', 'IPv4'), info('fd00::7', 'IPv6')],
  }
  expect(candidateUrls('0.0.0.0', 7788, false, interfaces)).toEqual([
    { url: 'http://192.168.1.5:7788', interface: 'en0' },
    { url: 'http://100.64.0.7:7788', interface: 'wt0' },
  ])
  expect(candidateUrls('::', 7788, true, interfaces).map((c) => c.url)).toEqual([
    'https://192.168.1.5:7788',
    'https://100.64.0.7:7788',
    'https://[fd00::7]:7788',
  ])
  expect(candidateUrls('100.64.0.7', 7788, false, interfaces)).toEqual([
    { url: 'http://100.64.0.7:7788', interface: 'listen address' },
  ])
})

it('expires inactive tokens and renews active devices without changing their credential', () => {
  const { path } = store()
  const devices = new DeviceStore(path, 600_000)
  const paired = devices.redeem(devices.createCode(1000).code, 'phone', 1000)!
  const header = `Bearer ${paired.token}`
  expect(paired.device.expiresAt).toBe(601_000)
  expect(devices.authenticate(header, 301_000)?.expiresAt).toBe(901_000)
  expect(devices.authenticate(header, 901_000)).toBeNull()
})

it('supports never-expiring devices only through an explicit lifetime choice', () => {
  const { path } = store()
  const devices = new DeviceStore(path, null)
  const paired = devices.redeem(devices.createCode(1000).code, 'phone', 1000)!
  expect(paired.device.expiresAt).toBeNull()
  expect(devices.authenticate(`Bearer ${paired.token}`, 1e12)).not.toBeNull()
})

it('bounds old device records by their last recorded use', () => {
  const { path, devices } = store()
  const paired = devices.redeem(devices.createCode(1000).code, 'old', 1000)!
  const file = JSON.parse(readFileSync(path, 'utf8'))
  delete file.devices[0].expiresAt
  delete file.devices[0].role
  writeFileSync(path, JSON.stringify(file))
  const migrated = new DeviceStore(path, 600_000)
  expect(migrated.list()[0]?.expiresAt).toBe(601_000)
  expect(migrated.authenticate(`Bearer ${paired.token}`, 601_000)).toBeNull()
})

it('lets the host choose how long devices stay paired, keeps the choice across pairings, and can return to the default', () => {
  const { devices, path } = store()
  const day = 86_400_000
  expect(devices.lifetime()).toEqual({ days: 90, saved: false })
  devices.setLifetime(7)
  expect(devices.lifetime()).toEqual({ days: 7, saved: true })
  const now = Date.now()
  const { code } = devices.createCode(now)
  const paired = devices.redeem(code, 'Phone', now)!
  expect(paired.device.expiresAt).toBe(now + 7 * day)
  // The choice survives later writes (new codes, revocation) and a fresh store reading the same file.
  devices.createCode(now)
  expect(new DeviceStore(path).lifetime()).toEqual({ days: 7, saved: true })
  expect(devices.authenticate(`Bearer ${paired.token}`, now + 8 * day)).toBeNull()

  devices.setLifetime('never')
  const second = devices.redeem(devices.createCode(now).code, 'Tablet', now)!
  expect(second.device.expiresAt).toBeNull()
  expect(devices.authenticate(`Bearer ${second.token}`, now + 3650 * day)?.id).toBe(second.device.id)

  devices.setLifetime(null)
  expect(devices.lifetime()).toEqual({ days: 90, saved: false })
})

it('rejects lifetimes outside 1 to 3650 days and ignores an invalid saved value', () => {
  const { devices, path } = store()
  for (const bad of [0, -1, 1.5, 3651, Number.NaN, '30' as unknown as number])
    expect(() => devices.setLifetime(bad)).toThrow()
  writeFileSync(path, JSON.stringify({ devices: [], pending: [], lifetimeDays: 99999 }))
  expect(devices.lifetime()).toEqual({ days: 90, saved: false })
})
