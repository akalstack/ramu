import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEVICE_MANAGEMENT_METHODS, refusedPermission } from '@ramu/shared/devicePermissions'
import { deviceChangeText } from '@ramu/shared/deviceChanges'
import { translate } from '@ramu/shared/i18n'
import type { DeviceChange, NetworkStatus, PairingOffer } from '@ramu/shared/types'
import { DeviceStore, type DeviceInfo } from '../src/remote/devices'
import { DeviceChanges, RemoteDeviceManagement } from '../src/remote/deviceManagement'
import { remoteRefusal } from '../src/remote/access'

const dirs: string[] = []
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})

/** A host with real device storage, and open connections that end once their token stops working, as the server's do. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ramu device management '))
  dirs.push(dir)
  const devices = new DeviceStore(join(dir, 'remote-devices.json'))
  const announced: DeviceChange[] = []
  const changes = new DeviceChanges(join(dir, 'device-changes.json'), (change) => announced.push(change))
  const streams = new Map<string, { header: string; open: boolean }>()
  const requests = [{ id: 'request-1', name: 'Pixel 9' }]
  const management = new RemoteDeviceManagement({
    devices,
    status: () => ({ devices: devices.panel() }) as unknown as NetworkStatus,
    pair: (role, owner) => {
      const offer = devices.createCode(Date.now(), role, owner)
      return { ...offer, urls: [] } as PairingOffer
    },
    cancelOffer: (offerId) => devices.cancelOffer(offerId),
    requests: () => requests,
    approve: (requestId, access) => {
      const request = requests.find((entry) => entry.id === requestId)
      if (!request) throw new Error('That request expired. Ask the device to try again.')
      return devices.redeem(devices.createCode(Date.now(), access).code, request.name)!.device
    },
    deny: () => {},
    removed: () => {
      for (const stream of streams.values()) if (!devices.authenticate(stream.header)) stream.open = false
    },
    changes,
  })
  const pair = (name: string, role: 'owner' | 'viewer' = 'owner', kind?: 'host') => {
    const paired = devices.redeem(devices.createCode(Date.now(), role).code, name, Date.now(), kind)!
    streams.set(paired.device.id, { header: `Bearer ${paired.token}`, open: true })
    return paired.device
  }
  return { devices, changes, announced, streams, management, pair }
}

const ids = (list: DeviceInfo[]) => list.map((device) => device.id).sort()

it('lets a full-access device with the settings permission manage devices, and asks for the permission otherwise', () => {
  const { devices, pair } = setup()
  const phone = pair('Ahmad’s iPhone')
  const allows = (id: string, permission: Parameters<DeviceStore['allows']>[1]) => devices.allows(id, permission)
  for (const method of [
    'network.status',
    'network.renameDevice',
    'network.revoke',
    'network.revokeOthers',
    'network.pair',
    'network.offer',
    'network.cancelOffer',
    'network.approveRequest',
    'network.denyRequest',
  ])
    expect(remoteRefusal(phone, method, allows)).toBeNull()
  // How the host is reached, and what each device may do, stay on the host.
  for (const method of [
    'network.configure',
    'network.setTunnel',
    'network.setPublicUrl',
    'network.setDevicePermission',
    'network.decidePermission',
    'network.setDefaultPermissions',
    'network.setDeviceExpiry',
  ])
    expect(DEVICE_MANAGEMENT_METHODS.has(method)).toBe(false)

  devices.setState(phone.id, 'settings', 'ask')
  const refusal = remoteRefusal(phone, 'network.revoke', allows)
  expect(refusal && refusedPermission(refusal)).toBe('settings')
})

it('refuses viewers and linked hosts, at the gate and again when managing', async () => {
  const { devices, management, pair } = setup()
  const viewer = pair('Reviewer', 'viewer')
  const host = pair('Build box', 'owner', 'host')
  const allows = (id: string, permission: Parameters<DeviceStore['allows']>[1]) => devices.allows(id, permission)
  expect(remoteRefusal(viewer, 'network.status', allows)).toMatch(/viewer/)
  expect(remoteRefusal(viewer, 'network.revoke', allows)).toMatch(/viewer/)
  expect(remoteRefusal(host, 'network.status', allows)).toMatch(/paired host may only/)
  expect(remoteRefusal(host, 'network.pair', allows)).toMatch(/paired host may only/)
  await expect(management.invoke(viewer, 'network.status', [])).rejects.toThrow(/full access/)
  await expect(management.invoke(host, 'network.revokeOthers', [])).rejects.toThrow(/full access/)
  expect(devices.list()).toHaveLength(2)
  const phone = pair('Ahmad’s iPhone')
  await expect(management.invoke(phone, 'network.configure', [])).rejects.toThrow(/managed from the host/)
})

it('lists devices, saying which one asks', async () => {
  const { management, pair } = setup()
  const phone = pair('Ahmad’s iPhone')
  pair('MacBook Air')
  const { value } = await management.invoke(phone, 'network.status', [])
  const status = value as NetworkStatus
  expect(status.self).toBe(phone.id)
  expect(status.devices.map((device) => device.name).sort()).toEqual(['Ahmad’s iPhone', 'MacBook Air'])
})

it('removes another device at once, closing its connections, and records who did it', async () => {
  const { devices, management, pair, streams, announced, changes } = setup()
  const phone = pair('Ahmad’s iPhone')
  const laptop = pair('MacBook Air')
  const { after } = await management.invoke(phone, 'network.revoke', [laptop.id])
  expect(after).toBeUndefined()
  expect(ids(devices.list())).toEqual([phone.id])
  expect(streams.get(laptop.id)?.open).toBe(false)
  expect(streams.get(phone.id)?.open).toBe(true)
  expect(announced).toHaveLength(1)
  expect(changes.list()).toEqual(announced)
  expect(deviceChangeText(announced[0]!, (text, values) => translate('en', text, values))).toBe(
    'Ahmad’s iPhone removed MacBook Air',
  )
  expect(typeof announced[0]!.at).toBe('number')
})

it('names devices only by their exact id, never all or a prefix, and leaves linked hosts to the host', async () => {
  const { devices, management, pair } = setup()
  const phone = pair('Ahmad’s iPhone')
  const laptop = pair('MacBook Air')
  const host = pair('Build box', 'owner', 'host')
  await expect(management.invoke(phone, 'network.revoke', ['all'])).rejects.toThrow(/no longer paired/)
  await expect(management.invoke(phone, 'network.revoke', [laptop.id.slice(0, 3)])).rejects.toThrow(/no longer paired/)
  await expect(management.invoke(phone, 'network.revoke', [host.id])).rejects.toThrow(/Linked hosts/)
  await expect(management.invoke(phone, 'network.revoke', ['x'.repeat(101)])).rejects.toThrow()
  await expect(management.invoke(phone, 'network.revoke', [42])).rejects.toThrow()
  expect(devices.list()).toHaveLength(3)
})

it('lets a device remove itself, answering before its own connection closes', async () => {
  const { devices, management, pair, streams, announced } = setup()
  const phone = pair('Ahmad’s iPhone')
  const { after } = await management.invoke(phone, 'network.revoke', [phone.id])
  expect(devices.list()).toHaveLength(0)
  expect(streams.get(phone.id)?.open).toBe(true)
  after?.()
  expect(streams.get(phone.id)?.open).toBe(false)
  expect(deviceChangeText(announced[0]!, (text, values) => translate('en', text, values))).toBe(
    'Ahmad’s iPhone removed itself',
  )
})

it('removes every other phone and computer, keeping the caller and linked hosts', async () => {
  const { devices, management, pair, streams, announced } = setup()
  const phone = pair('Ahmad’s iPhone')
  const laptop = pair('MacBook Air')
  const tablet = pair('iPad', 'viewer')
  const host = pair('Build box', 'owner', 'host')
  await management.invoke(phone, 'network.revokeOthers', [])
  expect(ids(devices.list())).toEqual([phone.id, host.id].sort())
  expect(streams.get(laptop.id)?.open).toBe(false)
  expect(streams.get(tablet.id)?.open).toBe(false)
  expect(streams.get(phone.id)?.open).toBe(true)
  expect(streams.get(host.id)?.open).toBe(true)
  expect(announced).toMatchObject([{ action: 'removedOthers', count: 2, byId: phone.id }])
})

it('renames a device and records the old and new name', async () => {
  const { devices, management, pair, announced } = setup()
  const phone = pair('Ahmad’s iPhone')
  const laptop = pair('MacBook Air')
  await management.invoke(phone, 'network.renameDevice', [laptop.id, 'Work laptop'])
  expect(devices.list().find((device) => device.id === laptop.id)?.name).toBe('Work laptop')
  expect(deviceChangeText(announced[0]!, (text, values) => translate('en', text, values))).toBe(
    'Ahmad’s iPhone renamed MacBook Air to Work laptop',
  )
  await expect(management.invoke(phone, 'network.renameDevice', [laptop.id, 'x'.repeat(201)])).rejects.toThrow()
})

it('makes a pairing code, follows only its own codes, and announces the device that used it', async () => {
  const { devices, management, pair, announced } = setup()
  const phone = pair('Ahmad’s iPhone')
  const other = pair('MacBook Air')
  const ownOnHost = devices.createCode(Date.now(), 'owner', 'dialog')
  const { value } = await management.invoke(phone, 'network.pair', ['viewer', 'screen'])
  const offer = value as PairingOffer
  expect(devices.offers().find((entry) => entry.id === offer.offerId)?.role).toBe('viewer')
  // Another device cannot follow or withdraw it, and this one cannot withdraw the code open on the host's screen.
  expect((await management.invoke(other, 'network.offer', [offer.offerId])).value).toEqual({ state: 'unknown' })
  expect((await management.invoke(other, 'network.cancelOffer', [offer.offerId])).value).toBe(false)
  expect((await management.invoke(phone, 'network.cancelOffer', [ownOnHost.offerId])).value).toBe(false)
  await expect(management.invoke(phone, 'network.pair', ['admin'])).rejects.toThrow()

  devices.redeem(offer.code, 'Pixel 9')
  const followed = (await management.invoke(phone, 'network.offer', [offer.offerId])).value
  expect(followed).toMatchObject({ state: 'redeemed', device: { name: 'Pixel 9', role: 'viewer' } })
  management.sweep()
  expect(announced).toHaveLength(1)
  expect(deviceChangeText(announced[0]!, (text, values) => translate('en', text, values))).toBe(
    'Ahmad’s iPhone connected a new device with view-only access: Pixel 9',
  )
})

it('announces a code used while nobody watched it, once', async () => {
  const { devices, management, pair, announced } = setup()
  const phone = pair('Ahmad’s iPhone')
  const offer = (await management.invoke(phone, 'network.pair', [])).value as PairingOffer
  devices.redeem(offer.code, 'Pixel 9')
  management.sweep()
  management.sweep()
  expect(announced).toMatchObject([{ action: 'connected', device: 'Pixel 9', role: 'owner' }])
})

it('answers a nearby device’s request and records it', async () => {
  const { devices, management, pair, announced } = setup()
  const phone = pair('Ahmad’s iPhone')
  await management.invoke(phone, 'network.approveRequest', ['request-1', 'owner'])
  expect(devices.list().map((device) => device.name)).toContain('Pixel 9')
  await management.invoke(phone, 'network.denyRequest', ['request-1'])
  expect(announced.map((change) => change.action)).toEqual(['connected', 'declined'])
  await expect(management.invoke(phone, 'network.approveRequest', ['request-1', 'root'])).rejects.toThrow()
})

it('keeps the most recent changes across a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu device changes '))
  dirs.push(dir)
  const path = join(dir, 'device-changes.json')
  const first = new DeviceChanges(path, () => {})
  for (let index = 0; index < 60; index++)
    first.record({ action: 'removedOthers', byId: 'a', by: 'Phone', count: index + 1 })
  const reopened = new DeviceChanges(path, () => {}).list()
  expect(reopened).toHaveLength(50)
  expect(reopened[0]).toMatchObject({ count: 60 })
})
