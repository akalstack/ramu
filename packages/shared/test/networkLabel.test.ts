import { expect, it } from 'vitest'
import { hostOfUrl, networkName, routeName } from '../src/networkLabel'

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

it('names the route a host is reached by', () => {
  expect(routeName('http://192.168.1.3:7788')).toBe('LAN')
  expect(routeName('http://ramu-753d.local:7788')).toBe('LAN')
  expect(routeName('http://100.101.2.3:7788')).toBe('VPN')
  expect(routeName('https://studio.tail1234.ts.net')).toBe('VPN')
  expect(routeName('https://ramu.example.com')).toBe('Tunnel')
  expect(routeName('http://8a1b.link.invalid')).toBe('Ramu Link')
  expect(routeName(null, 'me@studio')).toBe('SSH')
  expect(routeName('http://203.0.113.5:7788')).toBe('Internet')
  expect(routeName(null)).toBeNull()
})
