import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAIR_METHODS,
  availableMethods,
  browsingActive,
  cameraActive,
  initialMethod,
  pairingFill,
  sightingFromNative,
} from '../src/runtime/nearbyModel.ts'

const txt = ['v=1', 'id=a1b2c3d4e5f60718', 'scheme=https', 'name=Studio Mac']
const native = (patch = {}) => ({
  key: 'Studio Mac/192.168.1.20',
  txt,
  address: '192.168.1.20',
  port: 7788,
  interfaceName: 'en0',
  ...patch,
})

test('pairing offers nearby hosts, then the QR code, then manual entry', () => {
  assert.deepEqual([...PAIR_METHODS], ['nearby', 'qr', 'manual'])
  assert.deepEqual(availableMethods(true), ['nearby', 'qr', 'manual'])
  assert.deepEqual(availableMethods(false), ['manual'])
})

test('opening the screen starts discovery, not the camera', () => {
  const method = initialMethod(true, false)
  assert.equal(method, 'nearby')
  assert.equal(cameraActive(method, true), false)
  assert.equal(browsingActive(method, true), true)
})

test('an offer in a link goes straight to review, and the web has only manual entry', () => {
  assert.equal(initialMethod(true, true), 'manual')
  assert.equal(initialMethod(false, false), 'manual')
})

test('the camera runs only for QR and browsing only for nearby, and both stop in the background', () => {
  assert.equal(cameraActive('qr', true), true)
  assert.equal(cameraActive('qr', false), false)
  assert.equal(cameraActive('manual', true), false)
  assert.equal(browsingActive('nearby', false), false)
  assert.equal(browsingActive('qr', true), false)
  assert.equal(browsingActive('manual', true), false)
})

test('a native sighting becomes a listed host only when its advertisement and address are usable', () => {
  const found = sightingFromNative(native())
  assert.equal(found?.advert.name, 'Studio Mac')
  assert.equal(found?.endpoint.scheme, 'https')
  assert.equal(found?.interfaceName, 'en0')
  assert.equal(sightingFromNative(native({ txt: ['v=2', ...txt.slice(1)] }))?.advert, undefined)
  assert.equal(sightingFromNative(native({ txt: ['v=1', 'id=zz', 'scheme=https', 'name=x'] })), null)
  assert.equal(sightingFromNative(native({ txt: 'not an array' })), null)
  assert.equal(sightingFromNative(native({ port: 'x' })), null)
  assert.equal(sightingFromNative(null), null)
})

test('a chosen host fills only its address and name, and only for a route it actually has', () => {
  const host = { name: 'Studio Mac', routes: [{ url: 'https://192.168.1.20:7788' }] }
  assert.deepEqual(pairingFill(host, 'https://192.168.1.20:7788'), {
    address: 'https://192.168.1.20:7788',
    name: 'Studio Mac',
  })
  assert.equal(pairingFill(host, 'https://10.0.0.9:7788'), null)
})
