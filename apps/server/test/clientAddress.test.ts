import { expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientAddress } from '../src/remote/clientAddress'

const request = (remoteAddress: string, headers: Record<string, string | string[]> = {}) =>
  ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage

it('uses the socket address when no tunnel is set up', () => {
  expect(clientAddress(request('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }), null)).toEqual({
    address: '127.0.0.1',
    tunneled: false,
  })
})

it('names the visitor behind a tunnel on this computer', () => {
  expect(clientAddress(request('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }), 'cloudflare')).toEqual({
    address: '203.0.113.9',
    tunneled: true,
  })
  // The tunnel appends what it saw; anything before that came from the visitor and could be made up.
  expect(clientAddress(request('::1', { 'x-forwarded-for': '10.0.0.1, 198.51.100.4' }), 'proxy').address).toBe(
    '198.51.100.4',
  )
  expect(clientAddress(request('::ffff:127.0.0.1', { 'x-forwarded-for': 'not-an-ip' }), 'proxy')).toEqual({
    address: '::ffff:127.0.0.1',
    tunneled: true,
  })
})

it('ignores forwarding headers from any other address, where they could be forged', () => {
  expect(clientAddress(request('192.168.1.20', { 'cf-connecting-ip': '203.0.113.9' }), 'cloudflare')).toEqual({
    address: '192.168.1.20',
    tunneled: false,
  })
})

it('trusts CF-Connecting-IP only behind Cloudflare, since other proxies pass on what the visitor sent', () => {
  const forged = request('127.0.0.1', { 'cf-connecting-ip': '192.168.1.23', 'x-forwarded-for': '198.51.100.4' })
  expect(clientAddress(forged, 'proxy')).toEqual({ address: '198.51.100.4', tunneled: true })
  expect(clientAddress(request('127.0.0.1', { 'cf-connecting-ip': '192.168.1.23' }), 'proxy')).toEqual({
    address: '127.0.0.1',
    tunneled: true,
  })
})
