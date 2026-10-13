import { expect, it } from 'vitest'
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
