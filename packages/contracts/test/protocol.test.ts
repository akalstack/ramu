import { describe, expect, it } from 'vitest'
import { decodeInvoke, encodeInvoke, isLoopbackHost, parseRemoteUrl } from '../src'

it('keeps undefined arguments in position across the wire', () => {
  const request = decodeInvoke(encodeInvoke('x.y', [undefined, 'a', { nested: undefined }]))
  expect(request.method).toBe('x.y')
  expect(request.args).toHaveLength(3)
  expect(request.args[0]).toBeUndefined()
  expect(request.args[1]).toBe('a')
})

it('normalizes remote server addresses', () => {
  expect(parseRemoteUrl('192.168.1.5:7788')).toBe('http://192.168.1.5:7788')
  expect(parseRemoteUrl('https://ramu.example.com/path?x=1')).toBe('https://ramu.example.com')
  expect(() => parseRemoteUrl('ftp://host')).toThrow()
})

it('recognises loopback hosts', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) expect(isLoopbackHost(host)).toBe(true)
  for (const host of ['0.0.0.0', '192.168.1.5', 'example.com', '::']) expect(isLoopbackHost(host)).toBe(false)
})

import { encodePairLink, parsePairInput, parseSshTarget } from '../src'
describe('pairing links', () => {
  const soon = Date.now() + 60_000
  it('round-trips a ramu link', () => {
    const link = encodePairLink({ url: 'http://100.64.0.7:7788', code: 'K7QM2-X9RTD', expiresAt: soon })
    expect(link.startsWith('ramu://pair?')).toBe(true)
    expect(parsePairInput(link)).toMatchObject({ url: 'http://100.64.0.7:7788', code: 'K7QM2-X9RTD', expiresAt: soon })
  })
  it('rejects expired links, bad codes and other schemes', () => {
    expect(() =>
      parsePairInput(encodePairLink({ url: 'http://h:1', code: 'K7QM2-X9RTD', expiresAt: Date.now() - 1 })),
    ).toThrow(/expired/)
    expect(() => parsePairInput('ramu://pair?url=http://h:1&code=nope')).toThrow(/invalid code/)
    expect(() => parsePairInput('ramu://other?url=http://h:1')).toThrow(/not a Ramu pairing link/)
    expect(() => parsePairInput('ftp://h')).toThrow()
  })
  it('accepts https links with a code, and bare addresses', () => {
    expect(parsePairInput('https://box.example.com/#k7qm2-x9rtd')).toEqual({
      url: 'https://box.example.com',
      code: 'K7QM2-X9RTD',
    })
    expect(parsePairInput('100.64.0.7:7788')).toEqual({ url: 'http://100.64.0.7:7788' })
  })
  it('only accepts safe ssh targets', () => {
    expect(parseSshTarget('me@build-box')).toBe('me@build-box')
    expect(parseSshTarget('prod')).toBe('prod')
    expect(() => parseSshTarget('-oProxyCommand=touch /tmp/x')).toThrow()
    expect(() => parseSshTarget('a b')).toThrow()
  })
})
