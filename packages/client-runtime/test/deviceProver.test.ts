import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { verifyProof } from '@ramu/shared/deviceProof'
import { DeviceProver, deviceKey } from '../src/deviceProver'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const token = 'c'.repeat(64)

it('signs with its own clock until a host shows that clock is wrong, then with the host’s', async () => {
  const key = deviceKey(random)
  const host = 1_800_000_000_000
  // This device runs two hours behind the host.
  let now = host - 2 * 60 * 60_000
  const asked: string[] = []
  const prover = new DeviceProver(key, random, () => now, (async (url: string) => {
    asked.push(url)
    return new Response('{}', { headers: { date: new Date(host).toUTCString() } })
  }) as typeof fetch)
  expect(verifyProof(key.publicKey, token, 'socket', prover.header(token, 'socket'), host)).toEqual({
    ok: false,
    reason: 'stale',
  })
  await prover.sync('ws://10.0.0.2:7788/socket')
  expect(asked).toEqual(['http://10.0.0.2:7788/health'])
  expect(verifyProof(key.publicKey, token, 'socket', prover.header(token, 'socket'), host)).toMatchObject({ ok: true })
  // Asked again at once, it does not ask the host again.
  await prover.sync('http://10.0.0.2:7788')
  expect(asked).toHaveLength(1)
  now += 60_000
  await prover.sync('https://10.0.0.2:7788')
  expect(asked).toEqual(['http://10.0.0.2:7788/health', 'https://10.0.0.2:7788/health'])
})

it('keeps its own clock when the host’s is close or cannot be read', async () => {
  const key = deviceKey(random)
  const at = 1_800_000_000_000
  let answer: () => Promise<Response> = async () =>
    new Response('{}', { headers: { date: new Date(at + 4000).toUTCString() } })
  let now = at
  const prover = new DeviceProver(key, random, () => now, (() => answer()) as typeof fetch)
  await prover.sync('http://host:7788')
  expect(prover.header(token, 'renew').split('.')[1]).toBe(String(at))
  answer = async () => {
    throw new Error('offline')
  }
  now += 60_000
  await prover.sync('http://host:7788')
  expect(prover.header(token, 'renew').split('.')[1]).toBe(String(now))
})
