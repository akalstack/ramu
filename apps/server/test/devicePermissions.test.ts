import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { grantFor, permissionFor, permissionRefusal, refusedPermission } from '@ramu/shared/devicePermissions'
import { DeviceStore } from '../src/remote/devices'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-permissions-'))
  dirs.push(dir)
  return new DeviceStore(join(dir, 'devices.json'))
}
const pair = (devices: DeviceStore, role: 'owner' | 'viewer' = 'owner') =>
  devices.redeem(devices.createCode(Date.now(), role).code, 'Phone')!.device

it('gives a new full-access device the host’s defaults, and a viewer nothing', () => {
  const devices = store()
  expect(devices.allows(pair(devices).id, 'computer')).toBe(true)
  devices.setDefaultPermissions(['browser'])
  const phone = pair(devices)
  expect(devices.allows(phone.id, 'browser')).toBe(true)
  for (const permission of ['computer', 'terminal', 'settings'] as const)
    expect(devices.allows(phone.id, permission)).toBe(false)
  expect(devices.allows(pair(devices, 'viewer').id, 'browser')).toBe(false)
})

it('grants for a while, for good or until the device disconnects, and revokes', () => {
  const devices = store()
  devices.setDefaultPermissions([])
  const phone = pair(devices)
  const now = Date.now()
  devices.setPermission(phone.id, 'computer', grantFor('hour', now), now)
  expect(devices.allows(phone.id, 'computer', now + 59 * 60_000)).toBe(true)
  expect(devices.allows(phone.id, 'computer', now + 61 * 60_000)).toBe(false)
  devices.setPermission(phone.id, 'browser', grantFor('once', now), now)
  devices.setPermission(phone.id, 'terminal', grantFor('always', now), now)
  devices.endSession(phone.id)
  expect(devices.allows(phone.id, 'browser')).toBe(false)
  expect(devices.allows(phone.id, 'terminal')).toBe(true)
  devices.setPermission(phone.id, 'terminal', null)
  expect(devices.allows(phone.id, 'terminal')).toBe(false)
})

it('names the permission each call needs, leaving reads open', () => {
  expect(permissionFor('computer.input')).toBe('computer')
  expect(permissionFor('computer.session')).toBeNull()
  expect(permissionFor('hostBrowser.open')).toBe('browser')
  expect(permissionFor('hostBrowser.status')).toBeNull()
  expect(permissionFor('term.write')).toBe('terminal')
  expect(permissionFor('network.useLink')).toBe('settings')
  expect(permissionFor('network.link')).toBeNull()
  expect(permissionFor('settings.app.set')).toBe('settings')
  expect(permissionFor('settings.app.get')).toBeNull()
  expect(permissionFor('providers.status')).toBeNull()
  expect(permissionFor('agent.start')).toBeNull()
  expect(refusedPermission(permissionRefusal('browser'))).toBe('browser')
  expect(refusedPermission('Something else')).toBeNull()
})

it('remembers a “never” until the host allows the permission itself', () => {
  const devices = store()
  const phone = pair(devices)
  devices.block(phone.id, 'computer')
  expect(devices.allows(phone.id, 'computer')).toBe(false)
  expect(devices.blocked(phone.id)).toEqual(['computer'])
  devices.setPermission(phone.id, 'computer', null)
  expect(devices.blocked(phone.id)).toEqual(['computer'])
  devices.setPermission(phone.id, 'computer', grantFor('always', Date.now()))
  expect(devices.blocked(phone.id)).toEqual([])
  expect(devices.allows(phone.id, 'computer')).toBe(true)
})

it('sets a lasting state from Settings: allowed, ask first (which lifts a block) or blocked', () => {
  const devices = store()
  devices.setDefaultPermissions([])
  const phone = pair(devices)
  const now = Date.now()
  devices.setPermission(phone.id, 'terminal', grantFor('hour', now), now)
  devices.setState(phone.id, 'terminal', 'allowed', now)
  expect(devices.permissionsOf(phone.id, now).terminal).toEqual({ until: null })
  devices.setState(phone.id, 'terminal', 'blocked')
  expect(devices.allows(phone.id, 'terminal')).toBe(false)
  expect(devices.blocked(phone.id)).toEqual(['terminal'])
  devices.setState(phone.id, 'terminal', 'ask')
  expect(devices.allows(phone.id, 'terminal')).toBe(false)
  expect(devices.blocked(phone.id)).toEqual([])
})

it('never gives Agents without a person choosing it', () => {
  const devices = store()
  const device = pair(devices)
  expect(devices.allows(device.id, 'computer')).toBe(true)
  expect(devices.allows(device.id, 'agents')).toBe(false)
  expect(devices.permissionsOf(device.id).agents).toBeNull()
})

it('gives new devices Agents only once the host makes it a default', () => {
  const devices = store()
  expect(devices.defaultPermissions()).not.toContain('agents')
  const earlier = pair(devices)
  devices.setDefaultPermissions(['terminal', 'agents'])
  expect(devices.allows(pair(devices).id, 'agents')).toBe(true)
  expect(devices.allows(earlier.id, 'agents')).toBe(false)
})

it('asks for the Agents permission before a device can pair its agents', () => {
  expect(permissionFor('device.agentPairing')).toBe('agents')
  expect(refusedPermission(permissionRefusal('agents'))).toBe('agents')
})

it('keeps an agent code to one host pairing that follows the grant and leaves with the device', () => {
  const devices = store()
  const device = pair(devices)
  devices.setPermission(device.id, 'agents', grantFor('always', Date.now()))

  const code = devices.agentPairingCode(device.id)
  expect(devices.redeem(code, 'Stolen')).toBeNull()
  const agents = devices.redeem(code, 'Laptop (agents)', Date.now(), 'host')!
  expect(agents.device.kind).toBe('host')
  expect(devices.hostPairingActive(agents.device)).toBe(true)

  const panel = devices.panel()
  expect(panel.map((entry) => entry.id)).toEqual([device.id])
  expect(panel[0]?.agentHost).toEqual({ id: agents.device.id, maxAccess: 'edits' })

  devices.setPermission(device.id, 'agents', null)
  expect(devices.hostPairingActive(agents.device)).toBe(false)
  devices.setPermission(device.id, 'agents', grantFor('hour', 1000), 1000)
  expect(devices.hostPairingActive(agents.device, 1000 + 61 * 60_000)).toBe(false)

  devices.setPermission(device.id, 'agents', grantFor('always', Date.now()))
  const again = devices.redeem(devices.agentPairingCode(device.id), 'Laptop (agents)', Date.now(), 'host')!
  expect(
    devices
      .list()
      .filter((entry) => entry.kind === 'host')
      .map((entry) => entry.id),
  ).toEqual([again.device.id])

  expect(devices.revoke(device.id).map((entry) => entry.id)).toEqual([device.id, again.device.id])
  expect(devices.list()).toEqual([])
  expect(devices.hostPairingActive(again.device)).toBe(false)
})

it('refuses an agent code for a view-only device', () => {
  const devices = store()
  const device = pair(devices, 'viewer')
  expect(() => devices.agentPairingCode(device.id)).toThrow('full access')
})
