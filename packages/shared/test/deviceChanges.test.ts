import { expect, it } from 'vitest'
import { deviceChangeText } from '../src/deviceChanges'
import { translate } from '../src/i18n'
import { pushMessage } from '../src/pushChannels'
import { DEVICE_MANAGEMENT_METHODS, permissionFor } from '../src/devicePermissions'
import type { DeviceChange } from '../src/types'

const base = { id: '1', at: 1, byId: 'phone', by: 'Ahmad’s iPhone' }
const english = (change: DeviceChange) => deviceChangeText(change, (text, values) => translate('en', text, values))

it('says who changed which device, in a sentence for the person at the host', () => {
  expect(english({ ...base, action: 'removed', deviceId: 'mac', device: 'MacBook Air' })).toBe(
    'Ahmad’s iPhone removed MacBook Air',
  )
  expect(english({ ...base, action: 'removed', deviceId: 'phone', device: 'Ahmad’s iPhone' })).toBe(
    'Ahmad’s iPhone removed itself',
  )
  expect(english({ ...base, action: 'removedOthers', count: 1 })).toBe('Ahmad’s iPhone removed 1 other device')
  expect(english({ ...base, action: 'removedOthers', count: 3 })).toBe('Ahmad’s iPhone removed 3 other devices')
  expect(english({ ...base, action: 'renamed', deviceId: 'mac', device: 'MacBook Air', name: 'Work' })).toBe(
    'Ahmad’s iPhone renamed MacBook Air to Work',
  )
  expect(english({ ...base, action: 'connected', deviceId: 'p', device: 'Pixel 9', role: 'owner' })).toBe(
    'Ahmad’s iPhone connected a new device: Pixel 9',
  )
  expect(english({ ...base, action: 'declined', device: 'Pixel 9' })).toBe(
    'Ahmad’s iPhone declined a pairing request from Pixel 9',
  )
  expect(
    deviceChangeText({ ...base, action: 'removed', deviceId: 'mac', device: 'MacBook Air' }, (text, values) =>
      translate('id', text, values),
    ),
  ).toBe('Ahmad’s iPhone menghapus MacBook Air')
})

it('carries a change to the host’s own apps and drops a malformed one', () => {
  const change = { ...base, action: 'removedOthers', count: 2 }
  expect(pushMessage('devices:changed', change)).toEqual({ channel: 'devices:changed', payload: change })
  expect(pushMessage('devices:changed', { action: 'removed' })).toBeNull()
})

it('needs the settings permission for every device management call', () => {
  for (const method of DEVICE_MANAGEMENT_METHODS) expect(permissionFor(method)).toBe('settings')
  expect(permissionFor('network.configure')).toBeNull()
})
