import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeQuery, encodeResponse, decodeMessage, TYPE } from '@ramu/shared/discovery/mdns'
import { SERVICE_NAME } from '@ramu/shared/discovery/browse'
import { instanceLabel, publicationRecords, type Publication } from '@ramu/shared/discovery/advertise'
import {
  HostAdvertiser,
  advertisedInterfaces,
  readDiscoveryHostId,
  type LinkFactory,
  type MulticastLink,
} from '../src/remote/discovery'

type Interfaces = NonNullable<ReturnType<typeof import('node:os').networkInterfaces>>
const entry = (address: string, family: 'IPv4' | 'IPv6', internal = false) => ({
  address,
  family,
  internal,
  netmask: '',
  mac: '',
  cidr: null,
})
const interfaces = {
  lo0: [entry('127.0.0.1', 'IPv4', true)],
  en0: [entry('192.168.1.20', 'IPv4'), entry('fd00::20', 'IPv6'), entry('fe80::1', 'IPv6')],
  utun3: [entry('100.64.0.7', 'IPv4')],
  en5: [entry('fe80::9', 'IPv6')],
} as unknown as Interfaces
const hostId = 'a1b2c3d4e5f60718a1b2c3d4e5f60718'

function setup(options: { fail?: boolean } = {}) {
  const sent: { address: string; packets: Uint8Array[] }[] = []
  const handlers = new Map<string, (packet: Uint8Array) => void>()
  const closed: string[] = []
  const link: LinkFactory = async (address, onPacket) => {
    if (options.fail) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' })
    const record = { address, packets: [] as Uint8Array[] }
    sent.push(record)
    handlers.set(address, onPacket)
    const value: MulticastLink = {
      send: (packet) => record.packets.push(packet),
      close: () => closed.push(address),
    }
    return value
  }
  const advertiser = new HostAdvertiser({
    hostId,
    name: () => 'Studio Mac',
    interfaces: () => interfaces,
    link,
    random: () => 0,
  })
  return { advertiser, sent, handlers, closed }
}

const decodeAll = (packets: Uint8Array[]) => packets.map((packet) => decodeMessage(packet)!)
const addressesOf = (packets: Uint8Array[]) =>
  decodeAll(packets).flatMap((message) =>
    message.records.flatMap((record) =>
      record.data.type === 'A' || record.data.type === 'AAAA' ? [record.data.address] : [],
    ),
  )

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('advertisedInterfaces', () => {
  it('uses every non-loopback IPv4 interface for a wildcard and never link-local addresses', () => {
    expect(advertisedInterfaces('0.0.0.0', interfaces)).toEqual([
      { name: 'en0', join: '192.168.1.20', addresses: ['192.168.1.20'] },
      { name: 'utun3', join: '100.64.0.7', addresses: ['100.64.0.7'] },
    ])
    expect(advertisedInterfaces('::', interfaces)).toEqual([
      { name: 'en0', join: '192.168.1.20', addresses: ['192.168.1.20', 'fd00::20'] },
      { name: 'utun3', join: '100.64.0.7', addresses: ['100.64.0.7'] },
    ])
  })

  it('advertises only the interface that owns a specific bind address', () => {
    expect(advertisedInterfaces('100.64.0.7', interfaces)).toEqual([
      { name: 'utun3', join: '100.64.0.7', addresses: ['100.64.0.7'] },
    ])
    expect(advertisedInterfaces('10.9.9.9', interfaces)).toEqual([])
  })
})

describe('HostAdvertiser', () => {
  it('announces on each interface with only that interface address, and the bound port', async () => {
    const { advertiser, sent } = setup()
    await advertiser.start({ host: '0.0.0.0', port: 7788, tls: false })
    expect(sent.map((link) => link.address)).toEqual(['192.168.1.20', '100.64.0.7'])
    expect(addressesOf(sent[0]!.packets)).toEqual(['192.168.1.20'])
    expect(addressesOf(sent[1]!.packets)).toEqual(['100.64.0.7'])
    const srv = decodeAll(sent[0]!.packets)[0]!.records.find((record) => record.data.type === 'SRV')!
    expect(srv.data).toMatchObject({ port: 7788 })
    // Nothing identifying beyond the contract: no paths, users or codes in any record.
    const txt = decodeAll(sent[0]!.packets)[0]!.records.find((record) => record.data.type === 'TXT')!
    expect(txt.data.type === 'TXT' && txt.data.entries.map((line) => line.split('=')[0])).toEqual([
      'v',
      'id',
      'scheme',
      'name',
    ])
    expect(advertiser.status()).toMatchObject({
      state: 'advertising',
      interfaces: ['en0', 'utun3'],
      label: 'Studio Mac',
    })
    await vi.advanceTimersByTimeAsync(1100)
    expect(sent[0]!.packets).toHaveLength(2)
  })

  it('publishes nothing for a loopback-only listener', async () => {
    const { advertiser, sent } = setup()
    await advertiser.start({ host: '127.0.0.1', port: 7788, tls: false })
    expect(sent).toEqual([])
    expect(advertiser.status().state).toBe('off')
  })

  it('says goodbye and closes every socket when stopped', async () => {
    const { advertiser, sent, closed } = setup()
    await advertiser.start({ host: '0.0.0.0', port: 7788, tls: true })
    await advertiser.stop()
    const last = decodeAll(sent[0]!.packets).at(-1)!
    expect(last.records.every((record) => record.ttl === 0)).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(closed.sort()).toEqual(['100.64.0.7', '192.168.1.20'])
    expect(advertiser.status().state).toBe('off')
  })

  it('stays quiet about a failure instead of throwing, and reports it', async () => {
    const { advertiser } = setup({ fail: true })
    await expect(advertiser.start({ host: '0.0.0.0', port: 7788, tls: false })).resolves.toBeUndefined()
    expect(advertiser.status()).toMatchObject({ state: 'unavailable', error: 'EADDRINUSE' })
  })

  it('answers a browse question once per interface and ignores unrelated queries', async () => {
    const { advertiser, sent, handlers } = setup()
    await advertiser.start({ host: '100.64.0.7', port: 7788, tls: false })
    const before = sent[0]!.packets.length
    handlers.get('100.64.0.7')!(encodeQuery([{ name: '_other._tcp.local', type: TYPE.PTR }]))
    await vi.advanceTimersByTimeAsync(300)
    expect(sent[0]!.packets).toHaveLength(before)
    handlers.get('100.64.0.7')!(encodeQuery([{ name: SERVICE_NAME, type: TYPE.PTR }]))
    await vi.advanceTimersByTimeAsync(300)
    expect(sent[0]!.packets.length).toBe(before + 1)
  })

  it('takes the next free name when another host answers with ours', async () => {
    const { advertiser, handlers } = setup()
    await advertiser.start({ host: '100.64.0.7', port: 7788, tls: false })
    const rival: Publication = {
      label: instanceLabel('Studio Mac'),
      advert: { version: 1, hostId: 'ffff000000000000', name: 'Studio Mac', scheme: 'http' },
      port: 7788,
      addresses: ['100.64.0.9'],
    }
    handlers.get('100.64.0.7')!(encodeResponse(publicationRecords(rival, 120)))
    await vi.advanceTimersByTimeAsync(50)
    expect(advertiser.status().label).toBe('Studio Mac (2)')
  })

  it('follows a network change: withdraws a vanished interface and joins a new one', async () => {
    let current: Interfaces = interfaces
    const sent: string[] = []
    const closed: string[] = []
    const link: LinkFactory = async (address) => {
      sent.push(address)
      return { send: () => {}, close: () => closed.push(address) }
    }
    const advertiser = new HostAdvertiser({ hostId, name: () => 'Mac', interfaces: () => current, link })
    await advertiser.start({ host: '0.0.0.0', port: 7788, tls: false })
    current = { utun3: interfaces.utun3 } as unknown as Interfaces
    await advertiser.refresh()
    expect(closed).toEqual(['192.168.1.20'])
    expect(advertiser.status().interfaces).toEqual(['utun3'])
  })
})

describe('readDiscoveryHostId', () => {
  it('creates a random identifier once and keeps it across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-discovery-'))
    try {
      const first = readDiscoveryHostId(join(dir, 'nested', 'discovery.json'))
      expect(first).toMatch(/^[0-9a-f]{32}$/)
      expect(readDiscoveryHostId(join(dir, 'nested', 'discovery.json'))).toBe(first)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
