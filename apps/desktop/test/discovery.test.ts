import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { publicationRecords, type Publication } from '@ramu/shared/discovery/advertise'
import { SERVICE_NAME } from '@ramu/shared/discovery/browse'
import { decodeMessage, encodeResponse, TYPE } from '@ramu/shared/discovery/mdns'
import { NearbyBrowser, browseInterfaces, interfaceFor, type BrowseLinkFactory } from '../src/main/discovery'

const entry = (address: string, family: 'IPv4' | 'IPv6', netmask = '255.255.255.0', internal = false) => ({
  address,
  family,
  internal,
  netmask,
  mac: '',
  cidr: null,
})
const interfaces = {
  lo0: [entry('127.0.0.1', 'IPv4', '255.0.0.0', true)],
  en0: [entry('192.168.1.5', 'IPv4'), entry('fe80::1', 'IPv6')],
  utun3: [entry('100.64.0.2', 'IPv4', '255.192.0.0')],
  awdl0: [entry('169.254.3.3', 'IPv4', '255.255.0.0')],
} as unknown as ReturnType<typeof import('node:os').networkInterfaces>

const publication = (patch: Partial<Publication> = {}): Publication => ({
  label: 'Studio Mac',
  advert: { version: 1, hostId: 'a1b2c3d4e5f60718', name: 'Studio Mac', scheme: 'https' },
  port: 7788,
  addresses: ['192.168.1.20'],
  ...patch,
})
const response = (value: Publication, ttl = 120) => encodeResponse(publicationRecords(value, ttl))

function setup(options: { fail?: NodeJS.ErrnoException; limitMs?: number } = {}) {
  const sent: { packet: Uint8Array; via: string }[] = []
  let deliver: (packet: Uint8Array, from: string) => void = () => {}
  let fail: (error: NodeJS.ErrnoException) => void = () => {}
  const closed = vi.fn()
  const link: BrowseLinkFactory = async (_addresses, onPacket, onError) => {
    if (options.fail) throw options.fail
    deliver = onPacket
    fail = onError
    return { send: (packet, via) => sent.push({ packet, via }), close: closed }
  }
  const changed = vi.fn()
  const browser = new NearbyBrowser({ link, interfaces: () => interfaces, changed, limitMs: options.limitMs })
  return {
    browser,
    sent,
    closed,
    changed,
    deliver: (packet: Uint8Array, from = '192.168.1.20') => deliver(packet, from),
    fail: (error: NodeJS.ErrnoException) => fail(error),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

it('browses usable IPv4 interfaces only and names the interface a reply came from', () => {
  const used = browseInterfaces(interfaces)
  expect(used.map((item) => item.name)).toEqual(['en0', 'utun3'])
  expect(interfaceFor('192.168.1.20', used)).toBe('en0')
  expect(interfaceFor('100.64.9.9', used)).toBe('utun3')
  expect(interfaceFor('10.0.0.1', used)).toBeUndefined()
})

it('starts only when asked, asks on every interface, and lists a host that answers', async () => {
  const { browser, sent, deliver } = setup()
  expect(browser.state()).toEqual({ status: 'idle', hosts: [], timedOut: false })
  await browser.start()
  await vi.advanceTimersByTimeAsync(0)
  const question = decodeMessage(sent[0]!.packet)!.questions[0]!
  expect(question).toMatchObject({ name: SERVICE_NAME, type: TYPE.PTR })
  expect(sent.map((item) => item.via).sort()).toEqual(['100.64.0.2', '192.168.1.5'])
  deliver(response(publication()))
  const state = browser.state()
  expect(state.status).toBe('searching')
  expect(state.hosts).toMatchObject([{ name: 'Studio Mac', scheme: 'https', pairedHostId: null }])
  expect(state.hosts[0]!.routes).toEqual([{ url: 'https://192.168.1.20:7788', interfaceName: 'en0' }])
})

it('asks for missing records when only a pointer arrived', async () => {
  const { browser, sent, deliver } = setup()
  await browser.start()
  await vi.advanceTimersByTimeAsync(0)
  const before = sent.length
  deliver(encodeResponse(publicationRecords(publication(), 120).slice(0, 1)))
  const types = sent.slice(before).flatMap((item) => decodeMessage(item.packet)!.questions.map((q) => q.type))
  expect(types).toContain(TYPE.SRV)
  expect(types).toContain(TYPE.TXT)
  expect(browser.state().hosts).toEqual([])
})

it('removes a host that says goodbye and one that stops answering', async () => {
  const { browser, deliver } = setup()
  await browser.start()
  deliver(response(publication()))
  deliver(response(publication(), 0))
  expect(browser.state().hosts).toEqual([])
  deliver(
    response(
      publication({ label: 'Other', advert: { ...publication().advert, hostId: 'ffff000000000000', name: 'Other' } }),
      10,
    ),
  )
  expect(browser.state().hosts).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(11_000)
  expect(browser.state().hosts).toEqual([])
})

it('ignores its own computer and unusable addresses', async () => {
  const { browser, deliver } = setup()
  await browser.start()
  deliver(response(publication({ addresses: ['192.168.1.5'] })), '192.168.1.5')
  deliver(response(publication({ addresses: ['169.254.1.1', '127.0.0.1'] })))
  expect(browser.state().hosts).toEqual([])
})

it('stops cleanly: nothing is listed, the socket closes and late packets change nothing', async () => {
  const { browser, closed, deliver, sent } = setup()
  await browser.start()
  deliver(response(publication()))
  browser.stop()
  expect(closed).toHaveBeenCalledOnce()
  expect(browser.state()).toEqual({ status: 'idle', hosts: [], timedOut: false })
  deliver(response(publication()))
  expect(browser.state().hosts).toEqual([])
  const count = sent.length
  await vi.advanceTimersByTimeAsync(120_000)
  expect(sent.length).toBe(count)
})

it('Retry begins a fresh browse and drops what the old one found', async () => {
  const { browser, deliver } = setup()
  await browser.start()
  deliver(response(publication()))
  await browser.start()
  expect(browser.state().hosts).toEqual([])
  expect(browser.state().status).toBe('searching')
})

it('reports a platform refusal as denied and anything else as unavailable, without throwing', async () => {
  const denied = setup({ fail: Object.assign(new Error('x'), { code: 'EPERM' }) })
  expect((await denied.browser.start()).status).toBe('denied')
  const other = setup({ fail: Object.assign(new Error('x'), { code: 'EADDRINUSE' }) })
  expect((await other.browser.start()).status).toBe('unavailable')
  const later = setup()
  await later.browser.start()
  later.fail(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }))
  expect(later.browser.state().status).toBe('denied')
  expect(later.closed).toHaveBeenCalled()
})

it('stops itself at its time limit and offers Retry', async () => {
  const { browser, closed } = setup({ limitMs: 5000 })
  await browser.start()
  await vi.advanceTimersByTimeAsync(5001)
  expect(browser.state()).toEqual({ status: 'idle', hosts: [], timedOut: true })
  expect(closed).toHaveBeenCalled()
})

it('reports unavailable when this computer has no network to browse', async () => {
  const browser = new NearbyBrowser({ interfaces: () => ({ lo0: interfaces.lo0 }) as typeof interfaces })
  expect((await browser.start()).status).toBe('unavailable')
})
