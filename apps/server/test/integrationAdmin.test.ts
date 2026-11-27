import { expect, it } from 'vitest'
import { encryptedConnection, mayAdministerIntegrations } from '../src/remote/access'
import type { DeviceInfo } from '../src/remote/devices'

const device = (over: Partial<DeviceInfo> = {}) =>
  ({ id: 'phone', name: 'Phone', role: 'owner', ...over }) as DeviceInfo
const granted = (id: string, permission: string) => id === 'phone' && permission === 'settings'
const none = () => false

it('the person on the host can always set up its providers, accounts and connections', () => {
  expect(mayAdministerIntegrations({ network: false }, none)).toBe(true)
})

it('another device needs full access, Change settings and an encrypted connection', () => {
  expect(mayAdministerIntegrations({ network: true, device: device(), encrypted: true }, granted)).toBe(true)
  // Each missing piece refuses on its own.
  expect(mayAdministerIntegrations({ network: true, device: device(), encrypted: true }, none)).toBe(false)
  expect(mayAdministerIntegrations({ network: true, device: device(), encrypted: false }, granted)).toBe(false)
  expect(
    mayAdministerIntegrations({ network: true, device: device({ role: 'viewer' }), encrypted: true }, granted),
  ).toBe(false)
  expect(mayAdministerIntegrations({ network: true, device: device({ kind: 'host' }), encrypted: true }, granted)).toBe(
    false,
  )
  expect(mayAdministerIntegrations({ network: true, encrypted: true }, granted)).toBe(false)
})

it('a connection is encrypted over TLS, from this computer (where tunnels arrive) or over Tailscale', () => {
  expect(encryptedConnection({ encrypted: true, remoteAddress: '192.168.1.20' })).toBe(true)
  expect(encryptedConnection({ remoteAddress: '127.0.0.1' })).toBe(true)
  expect(encryptedConnection({ remoteAddress: '::1' })).toBe(true)
  expect(encryptedConnection({ remoteAddress: '::ffff:100.101.5.9' })).toBe(true)
  expect(encryptedConnection({ remoteAddress: 'fd7a:115c:a1e0::1' })).toBe(true)
  // Plain HTTP on a trusted network, or an address only near Tailscale's range, is not.
  expect(encryptedConnection({ remoteAddress: '192.168.1.20' })).toBe(false)
  expect(encryptedConnection({ remoteAddress: '100.128.0.1' })).toBe(false)
  expect(encryptedConnection(undefined)).toBe(false)
})
