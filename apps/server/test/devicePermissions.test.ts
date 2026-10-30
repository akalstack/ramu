import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

it('keeps every permission for a device paired before permissions, until one is changed', () => {
  const devices = store()
  const phone = pair(devices)
  // Simulate an older device record: no permissions field at all.
  const path = (devices as unknown as { path: string }).path
  const file = JSON.parse(readFileSync(path, 'utf8'))
  delete file.devices[0].permissions
  writeFileSync(path, JSON.stringify(file))
  expect(devices.allows(phone.id, 'settings')).toBe(true)
  devices.setPermission(phone.id, 'settings', null)
  expect(devices.allows(phone.id, 'settings')).toBe(false)
  expect(devices.allows(phone.id, 'computer')).toBe(true)
})

it('names the permission each call needs, leaving reads open', () => {
  expect(permissionFor('computer.input')).toBe('computer')
  expect(permissionFor('computer.session')).toBeNull()
  expect(permissionFor('hostBrowser.open')).toBe('browser')
  expect(permissionFor('hostBrowser.status')).toBeNull()
  expect(permissionFor('term.write')).toBe('terminal')
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
