import { describe, expect, it } from 'vitest'
import { OPERATION_KEY_PATTERN, decodeInvoke, encodeInvoke, isLoopbackHost, parseRemoteUrl } from '../src'

it('keeps undefined arguments in position across the wire', () => {
  const request = decodeInvoke(encodeInvoke('x.y', [undefined, 'a', { nested: undefined }]))
  expect(request.method).toBe('x.y')
  expect(request.args).toHaveLength(3)
  expect(request.args[0]).toBeUndefined()
  expect(request.args[1]).toBe('a')
})

it('carries an operation key only when one is given, and accepts only bounded plain keys', () => {
  expect(decodeInvoke(encodeInvoke('x.y', ['a'])).operationKey).toBeUndefined()
  expect(decodeInvoke(encodeInvoke('x.y', ['a'], 'op-12345678')).operationKey).toBe('op-12345678')
  expect(OPERATION_KEY_PATTERN.test('0b0e7f3a-1c2d-4e5f-8a9b-123456789abc')).toBe(true)
  for (const bad of ['short', 'has space123', 'a'.repeat(129), '../etc/passwd1'])
    expect(OPERATION_KEY_PATTERN.test(bad)).toBe(false)
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

import { PAIR_PAGE, encodePairLink, encodePairWebLink, parsePairInput, parseSshTarget } from '../src'
describe('pairing links', () => {
  it('puts the offer after # on getramu.dev/pair, so any camera opens it and the site never sees it', () => {
    const soon = Date.now() + 60_000
    const link = encodePairWebLink({
      url: 'http://100.64.0.7:7788',
      code: 'K7QM2-X9RTD',
      expiresAt: soon,
      name: 'Studio',
    })
    expect(link.startsWith(`${PAIR_PAGE}#`)).toBe(true)
    expect(new URL(link).search).toBe('')
    expect(parsePairInput(link)).toEqual({
      url: 'http://100.64.0.7:7788',
      code: 'K7QM2-X9RTD',
      expiresAt: soon,
      name: 'Studio',
    })
    expect(() => parsePairInput(`${PAIR_PAGE}#code=K7QM2-X9RTD`)).toThrow(/no address/)
  })
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

describe('flow control frames', () => {
  it('accepts a bounded acknowledgement and a boolean flow flag, and nothing else', async () => {
    const { decodeSocketFrame } = await import('../src')
    expect(decodeSocketFrame('{"t":"ack","id":"term-1","bytes":12}', 'client')).toEqual({
      t: 'ack',
      id: 'term-1',
      bytes: 12,
    })
    for (const bad of [
      '{"t":"ack","id":"","bytes":1}',
      '{"t":"ack","id":"a","bytes":-1}',
      '{"t":"ack","id":"a","bytes":1.5}',
      '{"t":"ack","id":"a"}',
      `{"t":"ack","id":"${'x'.repeat(200)}","bytes":1}`,
    ])
      expect(decodeSocketFrame(bad, 'client')).toBeNull()
    expect(decodeSocketFrame('{"t":"subscribe","id":1,"channels":["term:data"],"flow":true}', 'client')).toMatchObject({
      flow: true,
    })
    expect(decodeSocketFrame('{"t":"subscribe","id":1,"channels":["term:data"],"flow":"yes"}', 'client')).toBeNull()
    expect(
      decodeSocketFrame(
        '{"t":"subscribe","id":1,"channels":["agent:event"],"skip":{"agent:event":["text"]}}',
        'client',
      ),
    ).toMatchObject({ skip: { 'agent:event': ['text'] } })
    for (const skip of [
      '"text"',
      '{"agent:event":"text"}',
      '{"agent:event":[1]}',
      '{"agent:event":[""]}',
      `{"a":${JSON.stringify(Array(65).fill('k'))}}`,
    ])
      expect(
        decodeSocketFrame(`{"t":"subscribe","id":1,"channels":["agent:event"],"skip":${skip}}`, 'client'),
      ).toBeNull()
  })
})
