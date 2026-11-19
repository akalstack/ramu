import { expect, it } from 'vitest'
import { MockAgent } from 'undici'
import type { LookupFunction } from 'node:net'
import { isPublicMcpAddress, sharedMcpHttpFetch, sharedMcpLookup } from '../src/mcp/http'

it.each([
  '0.0.0.0',
  '10.1.2.3',
  '127.0.0.1',
  '100.64.1.1',
  '169.254.169.254',
  '172.31.0.1',
  '192.168.1.1',
  '224.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'fd00::1',
  'fe80::1',
  '2001:db8::1',
  '2002:7f00:1::',
])('denies private, reserved and tunneled destination %s', (address) => {
  expect(isPublicMcpAddress(address)).toBe(false)
})
it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
  'accepts public destination %s',
  (address) => {
    expect(isPublicMcpAddress(address)).toBe(true)
  },
)

const resolveWith = (lookup: LookupFunction, all = true) =>
  new Promise((resolve, reject) => {
    lookup('service.example', { all }, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    )
  })
it('uses the vetted addresses themselves and rejects mixed public/private DNS answers', async () => {
  const publicAnswers = [{ address: '8.8.8.8', family: 4 }]
  const resolve = async () => publicAnswers
  const lookup = sharedMcpLookup(false, resolve as never)
  expect(await resolveWith(lookup)).toEqual({ address: publicAnswers, family: undefined })
  expect(await resolveWith(lookup, false)).toEqual({ address: '8.8.8.8', family: 4 })
  publicAnswers.push({ address: '127.0.0.1', family: 4 })
  await expect(resolveWith(lookup)).rejects.toThrow('denied')
  expect(await resolveWith(sharedMcpLookup(true, resolve as never))).toEqual({
    address: publicAnswers,
    family: undefined,
  })
})

it('rejects unsafe endpoints before creating a network connection', () => {
  for (const endpoint of [
    'http://example.test/mcp',
    'https://user:secret@example.test/mcp',
    'https://example.test/mcp?token=secret',
    'https://127.0.0.1/mcp',
    'https://[::1]/mcp',
  ])
    expect(() => sharedMcpHttpFetch(endpoint)).toThrow()
})

it('never follows a redirect or sends credentials to a different origin', async () => {
  const dispatcher = new MockAgent()
  dispatcher.disableNetConnect()
  dispatcher
    .get('https://service.example')
    .intercept({ path: '/mcp', method: 'POST', headers: { authorization: 'Bearer service-test-key' } })
    .reply(307, '', { headers: { location: 'https://other.example/stolen' } })
  const network = sharedMcpHttpFetch('https://service.example/mcp', false, dispatcher)
  try {
    await expect(
      network.fetch('https://other.example/mcp', { headers: { authorization: 'Bearer service-test-key' } }),
    ).rejects.toThrow('Cross-origin')
    await expect(
      network.fetch('https://service.example/mcp', {
        method: 'POST',
        body: '{}',
        headers: { authorization: 'Bearer service-test-key' },
      }),
    ).rejects.toThrow('redirected')
    dispatcher.assertNoPendingInterceptors()
  } finally {
    await dispatcher.close()
  }
})

it('preserves successful content and bounds oversized responses', async () => {
  const dispatcher = new MockAgent()
  dispatcher.disableNetConnect()
  const pool = dispatcher.get('https://service.example')
  pool
    .intercept({ path: '/mcp', method: 'POST' })
    .reply(200, '{"ok":true}', { headers: { 'content-type': 'application/json' } })
  pool
    .intercept({ path: '/mcp', method: 'POST' })
    .reply(200, 'too large', { headers: { 'content-length': String(5 * 1024 * 1024) } })
  const network = sharedMcpHttpFetch('https://service.example/mcp', false, dispatcher)
  try {
    expect(await (await network.fetch('https://service.example/mcp', { method: 'POST' })).json()).toEqual({ ok: true })
    await expect(network.fetch('https://service.example/mcp', { method: 'POST' })).rejects.toThrow('supported size')
  } finally {
    await dispatcher.close()
  }
})
