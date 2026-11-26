import { describe, expect, it } from 'vitest'
import {
  fasterRoutes,
  hostOfUrl,
  networkName,
  routeEncrypted,
  routeName,
  routeSpeed,
  upgradeRoutes,
} from '../src/networkLabel'
import { linkHostname } from '../src/ramuLink'

it('names networks in plain words from the address and interface', () => {
  expect(networkName('192.168.1.20', 'en0')).toBe('Local network')
  expect(networkName('100.64.0.7', 'en0')).toBe('VPN')
  expect(networkName('10.8.0.2', 'wg0')).toBe('VPN')
  expect(networkName('172.17.0.1', 'docker0')).toBe('Virtual network')
  expect(networkName('8.8.8.8')).toBe('Other network')
})

it('names a tunnel address by the tunnel, never as a VPN', () => {
  expect(networkName('ramu-198535f899.akalstack.com', 'tunnel')).toBe('Ramu Link')
  expect(networkName('ramu-198535f899.akalstack.com')).toBe('Ramu Link')
  expect(networkName(linkHostname('198535f899'))).toBe('Ramu Link')
  expect(networkName('calm-river-1234.trycloudflare.com', 'tunnel')).toBe('Quick tunnel (Cloudflare)')
  expect(networkName('studio.tail1234.ts.net')).toBe('Tailscale')
  expect(networkName('abc123.ngrok-free.app')).toBe('ngrok')
  expect(networkName('ramu.example.com', 'tunnel')).toBe('Tunnel')
  // Only Ramu's own relay addresses are Ramu Link; one on another domain is the person's own relay.
  expect(networkName('ramu-abc.example.com')).toBe('Other network')
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
  expect(routeName('https://ramu.example.com')).toBe('Internet')
  expect(routeName(null, 'me@studio')).toBe('SSH')
  expect(routeName('http://203.0.113.5:7788')).toBe('Internet')
  expect(routeName(null)).toBeNull()
})

describe('route speed', () => {
  it('ranks the local network over a VPN over the internet', () => {
    expect(
      ['https://ramu-abc.akalstack.com', 'http://100.99.1.2:7788', 'http://192.168.1.20:7788'].map(routeSpeed),
    ).toEqual([2, 1, 0])
    expect(
      fasterRoutes('https://ramu-abc.akalstack.com', [
        'https://ramu-abc.akalstack.com',
        'http://100.99.1.2:7788',
        'http://192.168.1.20:7788',
        'http://10.0.0.5:7788',
      ]),
    ).toEqual(['http://192.168.1.20:7788', 'http://10.0.0.5:7788', 'http://100.99.1.2:7788'])
    expect(fasterRoutes('http://192.168.1.20:7788', ['http://100.99.1.2:7788'])).toEqual([])
  })
  it('counts https and VPN routes as encrypted, and plain local http as not', () => {
    expect(routeEncrypted('https://ramu-abc.akalstack.com')).toBe(true)
    expect(routeEncrypted('http://100.99.1.2:7788')).toBe(true)
    expect(routeEncrypted('http://192.168.1.20:7788')).toBe(false)
  })
})

describe('upgradeRoutes', () => {
  const link = 'https://ramu-abc.akalstack.com'
  const vpn = 'http://100.99.1.2:7788'
  const lan = 'http://192.168.1.20:7788'
  it('moves from an encrypted route only to another encrypted one unless plain LAN is allowed', () => {
    expect(upgradeRoutes(link, [link, vpn, lan])).toEqual([vpn])
    expect(upgradeRoutes(link, [link, vpn, lan], true)).toEqual([lan, vpn])
    expect(upgradeRoutes(vpn, [link, vpn, lan])).toEqual([])
    expect(upgradeRoutes(vpn, [lan], true)).toEqual([lan])
  })
  it('moves a plain internet address to the local network freely, since nothing is lost', () => {
    expect(upgradeRoutes('http://203.0.113.9:7788', [lan, vpn])).toEqual([lan, vpn])
  })
})
