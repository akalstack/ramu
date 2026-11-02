import { expect, it } from 'vitest'
import { hostOfUrl, networkName } from '../src/networkLabel'

it('names networks in plain words from the address and interface', () => {
  expect(networkName('192.168.1.20', 'en0')).toBe('Local network')
  expect(networkName('100.64.0.7', 'en0')).toBe('VPN')
  expect(networkName('10.8.0.2', 'wg0')).toBe('VPN')
  expect(networkName('172.17.0.1', 'docker0')).toBe('Virtual network')
  expect(networkName('8.8.8.8')).toBe('Other network')
})
it('reads the host from a saved route, including IPv6', () => {
  expect(hostOfUrl('http://100.64.0.7:7788')).toBe('100.64.0.7')
  expect(hostOfUrl('http://[fd7a:115c:a1e0::1]:7788')).toBe('fd7a:115c:a1e0::1')
})
