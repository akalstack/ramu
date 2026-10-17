import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_NETWORK_SETTING,
  localAddresses,
  readNetworkSetting,
  validateNetworkSetting,
  writeNetworkSetting,
} from '../src/remote/network'

const dirs: string[] = []
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu network '))
  dirs.push(dir)
  return join(dir, 'network.json')
}
const addresses = [
  { name: 'en0', address: '192.168.1.5' },
  { name: 'wt0', address: '100.64.0.7' },
]
const on = { enabled: true, host: '100.64.0.7', port: 7788, acceptUnencrypted: true }

it('accepts every network or one of this host’s addresses', () => {
  expect(validateNetworkSetting(on, false, addresses)).toEqual(on)
  expect(validateNetworkSetting({ ...on, host: '0.0.0.0' }, false, addresses).host).toBe('0.0.0.0')
  expect(validateNetworkSetting({ ...on, host: '127.0.0.1', acceptUnencrypted: false }, false, addresses).host).toBe(
    '127.0.0.1',
  )
  expect(() => validateNetworkSetting({ ...on, host: '10.9.9.9' }, false, addresses)).toThrow(/addresses/)
  expect(() => validateNetworkSetting({ ...on, host: 'example.com' }, false, addresses)).toThrow(/addresses/)
})

it('rejects bad ports and shapes', () => {
  for (const port of [80, 70000, 7788.5, Number.NaN])
    expect(() => validateNetworkSetting({ ...on, port }, false, addresses)).toThrow()
  expect(() => validateNetworkSetting(null, false, addresses)).toThrow(/Invalid/)
  expect(() => validateNetworkSetting({ ...on, enabled: 'yes' }, false, addresses)).toThrow(/Invalid/)
})

it('needs confirmation to listen beyond this host without TLS', () => {
  expect(() => validateNetworkSetting({ ...on, acceptUnencrypted: false }, false, addresses)).toThrow(
    /trust the network/,
  )
  expect(validateNetworkSetting({ ...on, acceptUnencrypted: false }, true, addresses).enabled).toBe(true)
  expect(validateNetworkSetting({ ...on, enabled: false, acceptUnencrypted: false }, false, addresses).enabled).toBe(
    false,
  )
})

it('saves privately and survives a missing or broken file', () => {
  const path = file()
  expect(readNetworkSetting(path, false)).toEqual(DEFAULT_NETWORK_SETTING)
  writeNetworkSetting(path, on)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  // The VPN may be down at boot; its address is kept rather than reset to the default.
  expect(readNetworkSetting(path, false)).toEqual(on)
  writeFileSync(path, '{broken')
  expect(readNetworkSetting(path, false)).toEqual(DEFAULT_NETWORK_SETTING)
  writeNetworkSetting(path, { ...on, acceptUnencrypted: false })
  expect(readNetworkSetting(path, false)).toEqual(DEFAULT_NETWORK_SETTING)
})

it('lists this host’s addresses without loopback or link-local', () => {
  for (const entry of localAddresses()) {
    expect(entry.address).not.toMatch(/^127\.|^fe80:|^169\.254\./i)
  }
})
