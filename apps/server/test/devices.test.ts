import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, type NetworkInterfaceInfo, type networkInterfaces } from 'node:os'
import { join } from 'node:path'
import {
  DeviceStore,
  ORPHAN_GRANT_MS,
  PAIRING_TTL_MS,
  RENEWAL_OVERLAP_MS,
  RENEWAL_PENDING_MS,
} from '../src/remote/devices'
import { candidateUrls } from '../src/remote/network'
import { HostName, systemHostName } from '../src/remote/hostName'

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
  expect(devices.authenticate(`Bearer ${paired.token}`, 1100)).not.toBeNull()
  expect(devices.authenticate(`Bearer ${paired.token}`, 1e12)).not.toBeNull()
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
  devices.authenticate(`Bearer ${second.token}`, now)
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

it('renews a token: the old one keeps working until the new one is used, then stops after a short overlap', () => {
  const { devices } = store()
  const paired = devices.redeem(devices.createCode().code, 'phone', 1000)!
  devices.authenticate(`Bearer ${paired.token}`, 1500)
  const renewed = devices.renew(`Bearer ${paired.token}`, 2000)!
  expect(renewed.token).not.toBe(paired.token)
  // A lost response: the old token is still the credential and the unused new one has not replaced it.
  expect(devices.authenticate(`Bearer ${paired.token}`, 3000)?.id).toBe(paired.device.id)
  // First use of the new token proves it was saved.
  expect(devices.authenticate(`Bearer ${renewed.token}`, 4000)?.id).toBe(paired.device.id)
  expect(devices.authenticate(`Bearer ${paired.token}`, 4000 + RENEWAL_OVERLAP_MS - 1)).not.toBeNull()
  expect(devices.authenticate(`Bearer ${paired.token}`, 4000 + RENEWAL_OVERLAP_MS + 1)).toBeNull()
  expect(devices.authenticate(`Bearer ${renewed.token}`, 4000 + RENEWAL_OVERLAP_MS + 1)).not.toBeNull()
})

it('names every key a device may hold: the current one, a pending renewed one and the previous one in its overlap', () => {
  const { devices } = store()
  const paired = devices.redeem(devices.createCode().code, 'phone', 1000)!
  const id = paired.device.id
  expect(devices.presenceKeys(id, 1500)).toHaveLength(1)
  const renewed = devices.renew(`Bearer ${paired.token}`, 2000)!
  expect(devices.presenceKeys(id, 2500)).toHaveLength(2)
  devices.authenticate(`Bearer ${renewed.token}`, 3000)
  expect(devices.presenceKeys(id, 3500)).toHaveLength(2)
  expect(devices.presenceKeys(id, 3000 + RENEWAL_OVERLAP_MS + 1)).toHaveLength(1)
  expect(devices.presenceKeys('missing')).toEqual([])
})

it('asking again before the new token is used replaces the unused one, and a replaced token cannot renew', () => {
  const { devices } = store()
  const paired = devices.redeem(devices.createCode().code, 'phone', 1000)!
  const first = devices.renew(`Bearer ${paired.token}`, 2000)!
  const second = devices.renew(`Bearer ${paired.token}`, 3000)!
  expect(devices.authenticate(`Bearer ${first.token}`, 3500)).toBeNull()
  expect(devices.authenticate(`Bearer ${second.token}`, 3500)).not.toBeNull()
  // The promoted-away token is only a grace credential for in-flight requests; it cannot mint another.
  expect(devices.renew(`Bearer ${paired.token}`, 3600)).toBeNull()
  expect(devices.renew(`Bearer ${second.token}`, 3600)).not.toBeNull()
})

it('drops an unused renewed token after its window, and a revoked or expired device cannot renew', () => {
  const { devices } = store()
  const paired = devices.redeem(devices.createCode().code, 'phone', 1000)!
  devices.authenticate(`Bearer ${paired.token}`, 1500)
  const renewed = devices.renew(`Bearer ${paired.token}`, 2000)!
  expect(devices.authenticate(`Bearer ${renewed.token}`, 2000 + RENEWAL_PENDING_MS + 1)).toBeNull()
  expect(devices.authenticate(`Bearer ${paired.token}`, 2000 + RENEWAL_PENDING_MS + 1)).not.toBeNull()
  devices.revoke(paired.device.id)
  expect(devices.renew(`Bearer ${paired.token}`, 5000)).toBeNull()
  expect(devices.renew(undefined, 5000)).toBeNull()
  const aging = store().devices
  const old = aging.redeem(aging.createCode().code, 'old', 1000)!
  expect(aging.renew(`Bearer ${old.token}`, 1000 + 91 * 24 * 60 * 60_000)).toBeNull()
})

it('lists unused offers without their codes, and cancelling one stops its code from pairing', () => {
  const { devices } = store()
  const first = devices.createCode(1000, 'owner', 'dialog-a')
  const second = devices.createCode(1000, 'viewer')
  expect(devices.offers(1000)).toEqual([
    { id: first.offerId, role: 'owner', expiresAt: first.expiresAt },
    { id: second.offerId, role: 'viewer', expiresAt: second.expiresAt },
  ])
  expect(JSON.stringify(devices.offers(1000))).not.toContain(first.code.replace('-', ''))
  expect(devices.cancelOffer(first.offerId, 1500)).toBe(true)
  expect(devices.redeem(first.code, 'late', 2000)).toBeNull()
  expect(devices.offerStatus(first.offerId, 2000)).toEqual({ state: 'cancelled' })
  expect(devices.cancelOffer(first.offerId, 2000)).toBe(false)
  // The independent offer is untouched and keeps its own role.
  expect(devices.redeem(second.code, 'tablet', 2000)?.device.role).toBe('viewer')
})

it("a dialog's next offer replaces its unused one, while other owners' offers keep their lifetime", () => {
  const { devices } = store()
  const a1 = devices.createCode(1000, 'owner', 'dialog-a')
  const b = devices.createCode(1000, 'owner', 'dialog-b')
  const a2 = devices.createCode(1000, 'viewer', 'dialog-a')
  expect(devices.redeem(a1.code, 'x', 1100)).toBeNull()
  expect(devices.offerStatus(a1.offerId, 1100)).toEqual({ state: 'cancelled' })
  expect(devices.offers(1100).map((o) => o.id)).toEqual([b.offerId, a2.offerId])
  // A role change is a new offer: the old code never changes its issued role.
  expect(devices.redeem(a2.code, 'y', 1100)?.device.role).toBe('viewer')
})

it('reports the outcome of that offer, not of any new device', () => {
  const { devices } = store()
  const mine = devices.createCode(1000, 'owner', 'dialog-a')
  const other = devices.createCode(1000, 'owner', 'dialog-b')
  const stranger = devices.redeem(other.code, 'someone else', 1100)!
  expect(devices.offerStatus(mine.offerId, 1100)).toMatchObject({ state: 'pending' })
  expect(devices.offerStatus(other.offerId, 1100)).toMatchObject({
    state: 'redeemed',
    device: { id: stranger.device.id, name: 'someone else', role: 'owner' },
  })
  const paired = devices.redeem(mine.code, 'phone', 1200)!
  expect(devices.offerStatus(mine.offerId, 1200)).toMatchObject({ state: 'redeemed', device: { id: paired.device.id } })
  expect(devices.offerStatus('nope', 1200)).toEqual({ state: 'unknown' })
  const expiring = devices.createCode(1000)
  expect(devices.offerStatus(expiring.offerId, 1000 + PAIRING_TTL_MS + 1)).toEqual({ state: 'expired' })
  // The offer status never leaks the token hash.
  expect(JSON.stringify(devices.offerStatus(other.offerId, 1100))).not.toContain('tokenHash')
})

it('a code spent on one writer cannot also be cancelled by another', () => {
  const { path, devices } = store()
  const cli = new DeviceStore(path)
  const offer = devices.createCode(1000)
  const phone = devices.redeem(offer.code, 'phone', 1100)!
  devices.authenticate(`Bearer ${phone.token}`, 1150)
  expect(cli.cancelOffer(offer.offerId, 1200)).toBe(false)
  expect(cli.offerStatus(offer.offerId, 1200)).toMatchObject({ state: 'redeemed' })
  expect(cli.list()).toHaveLength(1)
})

it('drops a grant whose token never made a request, and keeps one that did', () => {
  const { devices } = store()
  const now = Date.now()
  const lost = devices.redeem(devices.createCode().code, 'Lost response')!
  const used = devices.redeem(devices.createCode().code, 'Used')!
  expect(devices.authenticate(`Bearer ${used.token}`)?.id).toBe(used.device.id)
  // Before the window nothing is removed; afterwards only the grant nobody ever used goes.
  expect(
    devices
      .list(now + ORPHAN_GRANT_MS - 1)
      .map((device) => device.name)
      .sort(),
  ).toEqual(['Lost response', 'Used'])
  expect(devices.list(now + ORPHAN_GRANT_MS + 1000).map((device) => device.name)).toEqual(['Used'])
  expect(devices.authenticate(`Bearer ${lost.token}`, now + ORPHAN_GRANT_MS + 2000)).toBeNull()
  expect(devices.authenticate(`Bearer ${used.token}`, now + ORPHAN_GRANT_MS + 2000)?.id).toBe(used.device.id)
})

it('pairs a host as a limited kind with an edits ceiling and no device permissions', () => {
  const { devices } = store()
  const { code } = devices.createCode()
  const paired = devices.redeem(code, 'Build box (agents)', Date.now(), 'host')!
  expect(paired.device).toMatchObject({ kind: 'host', maxAccess: 'edits' })
  expect(devices.allows(paired.device.id, 'terminal')).toBe(false)
  devices.setMaxAccess(paired.device.id, 'auto')
  expect(devices.list().find((d) => d.id === paired.device.id)?.maxAccess).toBe('auto')
  const phone = devices.redeem(devices.createCode().code, 'Phone')!
  expect(phone.device.kind).toBeUndefined()
  expect(() => devices.setMaxAccess(phone.device.id, 'full')).toThrow(/Only a paired host/)
})

it('refuses to turn a view-only code into a host pairing, and leaves the code usable', () => {
  const { devices } = store()
  const { code } = devices.createCode(Date.now(), 'viewer')
  expect(devices.redeem(code, 'Sneaky', Date.now(), 'host')).toBeNull()
  expect(devices.redeem(code, 'Reviewer')?.device.role).toBe('viewer')
})

it('keeps one device paired for its own lifetime, works the expiry out from its last use, and can go back', () => {
  const { devices } = store()
  const paired = devices.redeem(devices.createCode().code, 'iPhone')!
  const now = Date.now()
  devices.authenticate(`Bearer ${paired.token}`, now)
  const listed = () => devices.list().find((device) => device.id === paired.device.id)!
  devices.setDeviceLifetime(paired.device.id, 7)
  expect(listed()).toMatchObject({ lifetimeDays: 7 })
  expect(listed().expiresAt! - now).toBeLessThanOrEqual(7 * 86_400_000)
  devices.setDeviceLifetime(paired.device.id, 'never')
  expect(listed().expiresAt).toBeNull()
  // Using it keeps its own choice instead of the host's default.
  devices.authenticate(`Bearer ${paired.token}`, now + 10 * 60_000)
  expect(listed().expiresAt).toBeNull()
  devices.setDeviceLifetime(paired.device.id, undefined)
  expect(listed().lifetimeDays).toBeUndefined()
  expect(listed().expiresAt).not.toBeNull()
  expect(() => devices.setDeviceLifetime(paired.device.id, 0)).toThrow(/1 and 3650/)
  expect(() => devices.setDeviceLifetime('gone', 7)).toThrow(/no longer paired/)
})

it('remembers what a device says it runs on', () => {
  const { devices } = store()
  const paired = devices.redeem(devices.createCode().code, 'Tablet')!
  devices.describe(paired.device.id, { os: 'android', form: 'tablet', version: '16', model: 'Pixel Tablet' })
  expect(devices.list()[0]!.os).toEqual({ os: 'android', form: 'tablet', version: '16', model: 'Pixel Tablet' })
})

it('gives a phone or tablet no Agents permission: it only connects to hosts and runs no agents of its own', () => {
  const { devices } = store()
  devices.setDefaultPermissions(['terminal', 'agents'])
  const phone = devices.redeem(devices.createCode().code, 'Phone')!.device.id
  const laptop = devices.redeem(devices.createCode().code, 'Laptop')!.device.id
  // Until it says what it is, a new device holds the host's defaults.
  expect(devices.allows(phone, 'agents')).toBe(true)
  devices.describe(phone, { os: 'ios', form: 'phone' })
  devices.describe(laptop, { os: 'macos', form: 'computer' })
  expect(devices.allows(phone, 'agents')).toBe(false)
  expect(devices.allows(phone, 'terminal')).toBe(true)
  expect(devices.permissionsOf(phone).agents).toBeNull()
  expect(devices.list().find((device) => device.id === phone)!.permissions).not.toHaveProperty('agents')
  expect(() => devices.setPermission(phone, 'agents', { until: null })).toThrow('no agents of its own')
  expect(() => devices.agentPairingCode(phone)).toThrow('no agents to pair')
  // A computer keeps it.
  expect(devices.allows(laptop, 'agents')).toBe(true)
  expect(devices.agentPairingCode(laptop)).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
})

it('renames a paired device and gives it back the name it paired with', () => {
  const { devices } = store()
  const { device } = devices.redeem(devices.createCode().code, 'iPhone')!
  expect(devices.rename(device.id, '  Work phone ')).toMatchObject({ name: 'Work phone', pairedName: 'iPhone' })
  // Renaming again keeps the name it paired with to go back to.
  expect(devices.rename(device.id, 'Pocket')).toMatchObject({ name: 'Pocket', pairedName: 'iPhone' })
  const back = devices.rename(device.id, null)
  expect(back.name).toBe('iPhone')
  expect(back).not.toHaveProperty('pairedName')
  expect(() => devices.rename('gone', 'x')).toThrow(/no longer paired/)
})

it('names this host as chosen, and goes back to the computer’s own name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu host name '))
  dirs.push(dir)
  const names = new HostName(join(dir, 'host-name.json'))
  expect(names.info()).toEqual({ name: systemHostName(), systemName: systemHostName(), custom: false })
  names.set('  Studio\nMac  ')
  // A fresh reader sees the saved choice, cleaned to one line.
  expect(new HostName(join(dir, 'host-name.json')).info()).toMatchObject({ name: 'Studio Mac', custom: true })
  names.set('   ')
  expect(names.display()).toBe(systemHostName())
})
