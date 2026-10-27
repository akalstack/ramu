import { expect, it } from 'vitest'
import { deviceProofKey, hostProof, learnedRoutes, MAX_LEARNED_ROUTES, verifyHost } from '../src/hostProof'

it('keeps a mesh route even when VM interfaces exhaust the route budget', () => {
  const bridges = Array.from({ length: 12 }, (_, i) => `http://192.168.${i}.1:7788`)
  const result = learnedRoutes([...bridges, 'http://100.99.224.30:7788'])
  expect(result).toHaveLength(MAX_LEARNED_ROUTES)
  expect(result[0]).toBe('http://100.99.224.30:7788')
  expect(result).toContain(bridges[0])
})

it('stores only canonical HTTP origins without credentials, paths, queries or fragments', () => {
  expect(
    learnedRoutes([
      'https://HOST:443/',
      'https://host',
      'http://user:secret@host',
      'http://host/path',
      'https://host?token=x',
      'ftp://host',
      'http://[fd00::1]:7788',
      null,
    ]),
  ).toEqual(['https://host', 'http://[fd00::1]:7788'])
})

const answer = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body })
const ask = (token: string, body: (challenge: string) => unknown) => {
  const challenge = 'c'.repeat(24)
  return verifyHost({ fetch: answer(body(challenge)), baseUrl: 'http://host', deviceId: 'd', token, challenge })
}

it('verifies a host that answers for the renewed token this device holds, not only for the current one', async () => {
  const current = deviceProofKey('current-token')
  const renewed = deviceProofKey('renewed-token')
  const body = (challenge: string) => ({
    hostId: 'h',
    proof: hostProof(current, 'h', challenge),
    alternates: [hostProof(renewed, 'h', challenge)],
  })
  expect((await ask('current-token', body)).state).toBe('verified')
  expect((await ask('renewed-token', body)).state).toBe('verified')
  expect((await ask('another-token', body)).state).toBe('mismatch')
})

it('ignores malformed alternates and never reads more than a few', async () => {
  const key = deviceProofKey('mine')
  const many = (challenge: string) => ({
    hostId: 'h',
    proof: 'nope',
    alternates: [1, null, 'x', 'y', hostProof(key, 'h', challenge)],
  })
  expect((await ask('mine', many)).state).toBe('mismatch')
  expect((await ask('mine', () => ({ hostId: 'h', proof: 'nope', alternates: 'oops' }))).state).toBe('mismatch')
})
