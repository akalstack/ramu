import { expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientAddress } from '../src/remote/clientAddress'

const request = (remoteAddress: string, headers: Record<string, string | string[]> = {}) =>
  ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage

it('uses the socket address when no tunnel is set up', () => {
  expect(clientAddress(request('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }), false)).toEqual({
    address: '127.0.0.1',
    tunneled: false,
  })
})

it('names the visitor behind a tunnel on this computer', () => {
  expect(clientAddress(request('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' }), true)).toEqual({
    address: '203.0.113.9',
    tunneled: true,
  })
  // The tunnel appends what it saw; anything before that came from the visitor and could be made up.
  expect(clientAddress(request('::1', { 'x-forwarded-for': '10.0.0.1, 198.51.100.4' }), true).address).toBe(
    '198.51.100.4',
  )
  expect(clientAddress(request('::ffff:127.0.0.1', { 'x-forwarded-for': 'not-an-ip' }), true)).toEqual({
    address: '::ffff:127.0.0.1',
    tunneled: true,
  })
})

it('ignores forwarding headers from any other address, where they could be forged', () => {
  expect(clientAddress(request('192.168.1.20', { 'cf-connecting-ip': '203.0.113.9' }), true)).toEqual({
    address: '192.168.1.20',
    tunneled: false,
  })
})
