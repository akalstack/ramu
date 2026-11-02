import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { answerLink, initiateLink, MAX_LINK_MESSAGE } from '../src/link/channel'
import { generateKeyPair } from '../src/link/noise'
import {
  bearerProtocol,
  credentialFromProtocols,
  decodeMux,
  encodeMux,
  hostProtocol,
  linkAddress,
  linkHostOf,
  linkServiceUrl,
  MUX,
} from '../src/link/protocol'
import { learnedRoutes, linkKeyProof, verifyHost, hostProof, deviceProofKey } from '../src/hostProof'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const HOST = '0123456789abcdef0123456789abcdef'
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

function pair(pinned?: string | null, hostId = HOST) {
  const identity = generateKeyPair(random)
  const device = initiateLink(HOST, random)
  const host = answerLink(hostId, identity, device.hello, random)
  return { identity, device: device.finish(host.reply, pinned), host: host.channel }
}

describe('Link channel', () => {
  it('carries messages both ways and proves the host key', () => {
    const { identity, device, host } = pair()
    expect(device.hostKey).toBe(hex(identity.publicKey))
    const [record] = device.seal(new TextEncoder().encode('hello'))
    expect(new TextDecoder().decode(host.open(record!)!)).toBe('hello')
    const [back] = host.seal(new TextEncoder().encode('hi'))
    expect(new TextDecoder().decode(device.open(back!)!)).toBe('hi')
  })

  it('splits large messages into frame-sized records and joins them in order', () => {
    const { device, host } = pair()
    const message = random(200_000)
    const records = device.seal(message)
    expect(records.length).toBeGreaterThan(3)
    expect(records.every((record) => record.length <= 64 * 1024)).toBe(true)
    const results = records.map((record) => host.open(record))
    expect(results.slice(0, -1).every((part) => part === null)).toBe(true)
    expect(Buffer.from(results.at(-1)!).equals(Buffer.from(message))).toBe(true)
    expect(() => device.seal(new Uint8Array(MAX_LINK_MESSAGE + 1))).toThrow('too large')
  })

  it('rejects a forged, replayed or reordered record', () => {
    const { device, host } = pair()
    const [first] = device.seal(new Uint8Array([1]))
    const [second] = device.seal(new Uint8Array([2]))
    const forged = first!.slice()
    forged[0]! ^= 1
    expect(() => host.open(forged)).toThrow()
    // Reordering fails because each record's nonce is its position.
    expect(() => host.open(second!)).toThrow()
    expect(host.open(first!)).toEqual(new Uint8Array([1]))
    expect(() => host.open(first!)).toThrow()
  })

  it('refuses a host whose key differs from the pinned one', () => {
    const other = hex(generateKeyPair(random).publicKey)
    expect(() => pair(other)).toThrow('identity changed')
  })

  it('does not complete with a host answering for another host id', () => {
    expect(() => pair(null, 'f'.repeat(32))).toThrow()
  })
})

describe('Link protocol', () => {
  it('addresses hosts under .invalid and parses them back', () => {
    expect(linkAddress(HOST)).toBe(`https://${HOST}.link.invalid`)
    expect(linkHostOf(linkAddress(HOST))).toBe(HOST)
    expect(linkHostOf(`https://${HOST}.link.invalid/socket`)).toBe(HOST)
    expect(linkHostOf('https://example.com')).toBeNull()
    expect(linkHostOf('http://' + HOST + '.link.invalid')).toBeNull()
  })

  it('round-trips multiplexed frames', () => {
    const frame = decodeMux(encodeMux(MUX.data, 0xfffffffe, new Uint8Array([7, 8])))
    expect(frame).toEqual({ type: MUX.data, stream: 0xfffffffe, payload: new Uint8Array([7, 8]) })
    expect(decodeMux(new Uint8Array([9, 0, 0, 0, 1]))).toBeNull()
  })

  it('reads credentials from the subprotocol list only for the asked kind', () => {
    const header = `ramu-link.v1, ${bearerProtocol('tok.en/+=')}, ${hostProtocol('secret')}`
    expect(credentialFromProtocols(header, 'bearer')).toBe('tok.en/+=')
    expect(credentialFromProtocols(header, 'host')).toBe('secret')
    expect(credentialFromProtocols('ramu-link.v1', 'bearer')).toBeNull()
  })

  it('accepts only HTTPS services, or HTTP on this computer', () => {
    expect(linkServiceUrl('https://link.example.com/path')).toBe('https://link.example.com')
    expect(linkServiceUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(() => linkServiceUrl('http://link.example.com')).toThrow()
  })

  it('keeps the Link address last and within the route bound', () => {
    const direct = Array.from({ length: 10 }, (_, index) => `http://192.168.1.${index + 1}:7788`)
    const routes = learnedRoutes([linkAddress(HOST), ...direct])
    expect(routes).toHaveLength(8)
    expect(routes.at(-1)).toBe(linkAddress(HOST))
  })
})

describe('host proof with a Link key', () => {
  const token = 'device-token'
  const answer =
    (linkKey: string, signedKey = linkKey) =>
    async (url: string) => {
      const challenge = new URL(url).searchParams.get('challenge')!
      const key = deviceProofKey(token)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          hostId: HOST,
          proof: hostProof(key, HOST, challenge),
          linkKey,
          linkProof: linkKeyProof(key, HOST, challenge, signedKey),
        }),
      }
    }
  const verify = (fetcher: ReturnType<typeof answer>) =>
    verifyHost({ fetch: fetcher, baseUrl: 'http://host', deviceId: 'd', token, challenge: 'c'.repeat(32) })

  it('returns a Link key the host vouched for', async () => {
    await expect(verify(answer('a'.repeat(64)))).resolves.toMatchObject({ state: 'verified', linkKey: 'a'.repeat(64) })
  })
  it('drops a Link key someone replaced on the way', async () => {
    const result = await verify(answer('b'.repeat(64), 'a'.repeat(64)))
    expect(result.state).toBe('verified')
    expect(result).not.toHaveProperty('linkKey')
  })
})

describe('Link client without a pinned key', () => {
  it('refuses to send a credential and to open a socket', async () => {
    const { linkFetch, linkSocketFactory } = await import('../src/link/client')
    const client = { account: () => ({ service: 'https://link.example', token: 't' }), pinned: () => null, random }
    const address = `https://${HOST}.link.invalid`
    await expect(
      linkFetch(client, fetch)(`${address}/session`, { headers: { Authorization: 'Bearer x' } }),
    ).rejects.toThrow('learns its Link key')
    const closed = await new Promise((resolve) =>
      linkSocketFactory(client, () => ({ send() {}, close() {} }))(
        `wss://${HOST}.link.invalid/socket`,
        {},
        {
          onopen() {},
          onmessage() {},
          onclose: resolve,
        },
      ),
    )
    expect(closed).toEqual({ code: 'ELINKPIN' })
  })
})
