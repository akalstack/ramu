import { describe, expect, it } from 'vitest'
import { PAIR_PAGE, parsePairInput } from '@ramu/contracts'
import type { NetworkStatus } from '@ramu/shared/types'
import { countdown, defaultPairUrl, pairingNetwork, pairingUrls, pairQrText } from '../src/pairingOffer'

const status = (patch: Partial<NetworkStatus> = {}) =>
  ({
    enabled: false,
    host: '127.0.0.1',
    port: 7788,
    source: 'settings',
    discovery: { discoverable: false, state: 'off', interfaces: [], error: null, name: 'Studio' },
    ...patch,
  }) as NetworkStatus

describe('pairing a phone', () => {
  it('puts a getramu.dev link in the QR code, which the app reads back with the code and host name', () => {
    const offer = { code: 'K7QM2-X9RTD', expiresAt: Date.now() + 60_000 }
    const text = pairQrText(offer, 'http://192.168.1.4:7788', 'Studio')
    expect(text.startsWith(`${PAIR_PAGE}#`)).toBe(true)
    expect(parsePairInput(text)).toMatchObject({ url: 'http://192.168.1.4:7788', code: 'K7QM2-X9RTD', name: 'Studio' })
  })

  it('adds the host’s tunnel address as a backup for a local address, and nothing else', () => {
    const offer = {
      code: 'K7QM2-X9RTD',
      expiresAt: Date.now() + 60_000,
      urls: [
        { url: 'https://ramu-abc.akalstack.com', interface: 'tunnel' },
        { url: 'http://192.168.1.4:7788', interface: 'en0' },
        { url: 'http://100.64.0.7:7788', interface: 'utun4' },
      ],
    }
    expect(parsePairInput(pairQrText(offer, 'http://192.168.1.4:7788'))).toMatchObject({
      alternates: ['https://ramu-abc.akalstack.com'],
    })
    expect(parsePairInput(pairQrText(offer, 'https://ramu-abc.akalstack.com'))).not.toHaveProperty('alternates')
  })

  it('allows devices on every network and makes the host visible, unless that is already so or set on the command line', () => {
    expect(pairingNetwork(status())).toEqual({
      enabled: true,
      host: '0.0.0.0',
      port: 7788,
      acceptUnencrypted: true,
      discoverable: true,
    })
    // A network the person chose stays chosen.
    expect(pairingNetwork(status({ enabled: true, host: '100.64.0.7' }))).toMatchObject({ host: '100.64.0.7' })
    const ready = status({
      enabled: true,
      host: '0.0.0.0',
      discovery: { discoverable: true, state: 'advertising', interfaces: ['en0'], error: null, name: 'Studio' },
    })
    expect(pairingNetwork(ready)).toBeNull()
    expect(pairingNetwork(status({ source: 'command-line' }))).toBeNull()
  })

  it('offers a real network address first, IPv4 before IPv6, and Docker or VM bridges last', () => {
    const urls = [
      { url: 'http://172.17.0.1:7788', interface: 'docker0' },
      { url: 'http://[fd00::4]:7788', interface: 'en0' },
      { url: 'http://192.168.1.4:7788', interface: 'en0' },
    ]
    expect(pairingUrls(urls).likely.map((entry) => entry.url)).toEqual([
      'http://192.168.1.4:7788',
      'http://[fd00::4]:7788',
    ])
    expect(defaultPairUrl(urls)).toBe('http://192.168.1.4:7788')
    expect(defaultPairUrl([urls[0]!])).toBe('http://172.17.0.1:7788')
    expect(defaultPairUrl([])).toBeUndefined()
  })

  it('counts down in minutes and seconds, never below zero', () => {
    expect(countdown(125_000, 0)).toBe('2:05')
    expect(countdown(0, 5_000)).toBe('0:00')
  })
})
