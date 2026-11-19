import { describe, expect, it } from 'vitest'
import { asks, conflictsWith, instanceLabel, publicationRecords, type Publication } from '../src/discovery/advertise'
import { DnsSdCollector, SERVICE_NAME } from '../src/discovery/browse'
import {
  DISCOVERY_VERSION,
  cleanDiscoveryName,
  encodeAdvert,
  endpointUrl,
  parseAdvert,
  usableAddress,
  type DiscoveryAdvert,
} from '../src/discovery/contract'
import { TYPE, decodeMessage, encodeQuery, encodeResponse } from '../src/discovery/mdns'
import { DiscoveryTracker } from '../src/discovery/tracker'

const advert = (patch: Partial<DiscoveryAdvert> = {}): DiscoveryAdvert => ({
  version: DISCOVERY_VERSION,
  hostId: 'a1b2c3d4e5f60718',
  name: 'Studio Mac',
  scheme: 'https',
  ...patch,
})
const publication = (patch: Partial<Publication> = {}): Publication => ({
  label: 'Studio Mac',
  advert: advert(),
  port: 7788,
  addresses: ['192.168.1.20', 'fd00::20'],
  ...patch,
})

describe('advertisement metadata', () => {
  it('round-trips and ignores unknown keys', () => {
    const entries = [...encodeAdvert(advert()), 'extra=ignored']
    expect(parseAdvert(entries)).toEqual({ ok: true, advert: advert() })
  })

  it('rejects malformed fields and newer versions without interpreting them', () => {
    expect(parseAdvert(['v=1', 'id=zz', 'scheme=https', 'name=x'])).toEqual({ ok: false, reason: 'malformed' })
    expect(parseAdvert(['v=1', 'id=a1b2c3d4e5f60718', 'scheme=ftp', 'name=x'])).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(parseAdvert(['v=1', 'id=a1b2c3d4e5f60718', 'scheme=https', 'name=  '])).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(parseAdvert(['v=2', 'id=a1b2c3d4e5f60718', 'scheme=https', 'name=x'])).toEqual({
      ok: false,
      reason: 'incompatible',
    })
    expect(parseAdvert(Array.from({ length: 40 }, (_, i) => `k${i}=v`))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('cleans control characters, bidi overrides and length from names', () => {
    expect(cleanDiscoveryName('  Mac‮\nmini\u0000 ')).toBe('Mac mini')
    expect(cleanDiscoveryName('x'.repeat(200))).toHaveLength(48)
    expect(instanceLabel('my.host.name')).toBe('my-host-name')
    expect(instanceLabel('Mac', 1)).toBe('Mac (2)')
  })

  it('offers only plain routable address literals', () => {
    expect(endpointUrl({ address: '192.168.1.20', port: 7788, scheme: 'http' })).toBe('http://192.168.1.20:7788')
    expect(endpointUrl({ address: 'fd00::20', port: 7788, scheme: 'https' })).toBe('https://[fd00::20]:7788')
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '169.254.1.1',
      '224.0.0.1',
      '::1',
      'fe80::1',
      'fe80::1%en0',
      'evil.example',
    ])
      expect(usableAddress(address)).toBe(false)
    expect(endpointUrl({ address: '10.0.0.5', port: 80, scheme: 'http' })).toBeNull()
    expect(endpointUrl({ address: '10.0.0.5', port: 70000, scheme: 'http' })).toBeNull()
  })
})

describe('multicast DNS codec', () => {
  it('round-trips a full advertisement', () => {
    const decoded = decodeMessage(encodeResponse(publicationRecords(publication(), 120)))!
    expect(decoded.response).toBe(true)
    expect(decoded.records.map((record) => record.data.type).sort()).toEqual(['A', 'AAAA', 'PTR', 'SRV', 'TXT'])
    const srv = decoded.records.find((record) => record.data.type === 'SRV')!
    expect(srv.flush).toBe(true)
    expect(srv.data).toMatchObject({ port: 7788 })
  })

  it('drops truncated, oversized and looping packets instead of throwing', () => {
    const good = encodeResponse(publicationRecords(publication(), 120))
    expect(decodeMessage(good.slice(0, 20))).toBeNull()
    expect(decodeMessage(new Uint8Array(10_000))).toBeNull()
    const loop = Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0xc0, 12, 0, 12, 0, 1])
    expect(decodeMessage(loop)).toBeNull()
  })

  it('decodes a query', () => {
    const query = decodeMessage(encodeQuery([{ name: SERVICE_NAME, type: TYPE.PTR }]))!
    expect(query.response).toBe(false)
    expect(asks(query, publication())).toBe(true)
    expect(asks(decodeMessage(encodeQuery([{ name: '_other._tcp.local', type: TYPE.PTR }]))!, publication())).toBe(
      false,
    )
  })
})

describe('browsing', () => {
  const ingest = (collector: DnsSdCollector, records: ReturnType<typeof publicationRecords>, iface?: string) =>
    collector.ingest(decodeMessage(encodeResponse(records))!, iface)

  it('reports a host once instance, metadata and an address are all known, and asks for what is missing', () => {
    const collector = new DnsSdCollector()
    const records = publicationRecords(publication(), 120)
    const partial = ingest(collector, records.slice(0, 1))
    expect(partial.sightings).toEqual([])
    expect(partial.followUps.map((question) => question.type).sort()).toEqual([TYPE.TXT, TYPE.SRV])
    const noAddress = ingest(collector, records.slice(0, 3))
    expect(noAddress.sightings).toEqual([])
    expect(noAddress.followUps.map((question) => question.type)).toEqual([TYPE.A, TYPE.AAAA])
    const complete = ingest(collector, records)
    expect(complete.sightings.map((sighting) => sighting.endpoint.address).sort()).toEqual(['192.168.1.20', 'fd00::20'])
    expect(complete.sightings[0]!.ttlMs).toBe(120_000)
  })

  it('does not list a host whose metadata is malformed or from a newer protocol', () => {
    const collector = new DnsSdCollector()
    const records = publicationRecords(publication({ advert: advert({ version: 9 }) }), 120)
    expect(ingest(collector, records).sightings).toEqual([])
  })

  it('withdraws exactly what a goodbye announced', () => {
    const collector = new DnsSdCollector()
    const shown = ingest(collector, publicationRecords(publication(), 120)).sightings.map((sighting) => sighting.key)
    const bye = ingest(collector, publicationRecords(publication(), 0))
    expect(bye.lost.sort()).toEqual(shown.sort())
  })

  it('bounds the number of remembered instances', () => {
    const collector = new DnsSdCollector()
    for (let i = 0; i < 150; i++)
      ingest(
        collector,
        publicationRecords(
          publication({ label: `Host ${i}`, advert: advert({ hostId: i.toString(16).padStart(16, '0') }) }),
          120,
        ),
      )
    const visible = ingest(collector, publicationRecords(publication({ label: 'Late' }), 120))
    expect(visible.sightings).toEqual([])
  })
})

describe('tracker', () => {
  const sighting = (
    patch: { key?: string; advert?: DiscoveryAdvert; address?: string; ttlMs?: number; interfaceName?: string } = {},
  ) => ({
    key: patch.key ?? 'a/192.168.1.20',
    advert: patch.advert ?? advert(),
    endpoint: { address: patch.address ?? '192.168.1.20', port: 7788, scheme: 'https' as const },
    ttlMs: patch.ttlMs ?? 120_000,
    ...(patch.interfaceName ? { interfaceName: patch.interfaceName } : {}),
  })

  it('merges interfaces only when identifier, name and transport all agree', () => {
    const tracker = new DiscoveryTracker()
    const session = tracker.begin()
    tracker.observe(session, sighting({ key: 'a/1', address: '192.168.1.20', interfaceName: 'en0' }))
    tracker.observe(session, sighting({ key: 'a/2', address: '10.0.0.4', interfaceName: 'utun3' }))
    // The same identifier with another name is a different (possibly spoofing) device, not a second route.
    tracker.observe(session, sighting({ key: 'b/1', address: '192.168.1.99', advert: advert({ name: 'Other' }) }))
    const hosts = tracker.hosts()
    expect(hosts).toHaveLength(2)
    expect(hosts.find((host) => host.name === 'Studio Mac')!.routes.map((route) => route.url)).toEqual([
      'https://192.168.1.20:7788',
      'https://10.0.0.4:7788',
    ])
  })

  it('tells same-named hosts apart and never claims a verified pairing by itself', () => {
    const tracker = new DiscoveryTracker()
    const session = tracker.begin()
    tracker.observe(session, sighting({ key: 'a', advert: advert({ hostId: 'aaaa000000000000' }) }))
    tracker.observe(
      session,
      sighting({ key: 'b', advert: advert({ hostId: 'bbbb000000000000' }), address: '192.168.1.21' }),
    )
    const hosts = tracker.hosts()
    expect(hosts.map((host) => host.label)).toEqual(['Studio Mac (aaaa)', 'Studio Mac (bbbb)'])
    expect(hosts.every((host) => host.pairedHostId === null)).toBe(true)
  })

  it('expires vanished hosts and rejects late callbacks after close or retry', () => {
    let now = 1_000
    const tracker = new DiscoveryTracker({ now: () => now })
    const first = tracker.begin()
    expect(tracker.observe(first, sighting({ ttlMs: 10_000 }))).toBe(true)
    now += 11_000
    expect(tracker.hosts()).toEqual([])
    const second = tracker.begin()
    expect(tracker.observe(first, sighting())).toBe(false)
    expect(tracker.observe(second, sighting())).toBe(true)
    tracker.close()
    expect(tracker.observe(second, sighting())).toBe(false)
    expect(tracker.hosts()).toEqual([])
  })

  it('bounds results and rejects unusable endpoints', () => {
    const tracker = new DiscoveryTracker()
    const session = tracker.begin()
    for (let i = 0; i < 80; i++)
      tracker.observe(
        session,
        sighting({ key: `k${i}`, advert: advert({ hostId: i.toString(16).padStart(16, '0'), name: `H${i}` }) }),
      )
    expect(tracker.hosts()).toHaveLength(50)
    expect(tracker.observe(session, sighting({ key: 'x', address: 'fe80::1%en0' }))).toBe(false)
  })

  it('reports whether a selected row is still the same route', () => {
    const tracker = new DiscoveryTracker()
    const session = tracker.begin()
    tracker.observe(session, sighting({ key: 'a/1' }))
    const key = tracker.hosts()[0]!.key
    expect(tracker.selection(key, 'https://192.168.1.20:7788')).toBe('same')
    expect(tracker.selection(key, 'https://192.168.1.5:7788')).toBe('changed')
    tracker.lose(session, 'a/1')
    expect(tracker.selection(key, 'https://192.168.1.20:7788')).toBe('gone')
    expect(tracker.selection(null, null)).toBe('none')
  })
})

describe('advertiser rules', () => {
  it('detects another host under our instance name but not our own repeats', () => {
    const ours = publication()
    const ownAnswer = decodeMessage(encodeResponse(publicationRecords(ours, 120)))!
    expect(conflictsWith(ownAnswer, ours)).toBe(false)
    const theirs = decodeMessage(
      encodeResponse(publicationRecords(publication({ advert: advert({ hostId: 'ffff000000000000' }) }), 120)),
    )!
    expect(conflictsWith(theirs, ours)).toBe(true)
  })

  it('omits unusable addresses from what it publishes', () => {
    const records = publicationRecords(publication({ addresses: ['127.0.0.1', 'fe80::1', '192.168.1.20'] }), 120)
    expect(records.filter((record) => record.data.type === 'A' || record.data.type === 'AAAA')).toHaveLength(1)
  })
})
