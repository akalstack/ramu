import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { generateKeyPair } from '../src/link/noise'
import { hookHeaders, openHook, sealHook, type LinkHook } from '../src/link/hooks'
import { MUX, decodeMux, encodeMux } from '../src/link/protocol'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const hook: LinkHook = { token: 't'.repeat(32), headers: { 'x-github-event': 'push' }, body: 'e30=', receivedAt: 1 }

it('opens a sealed request only with the host’s own key, and every seal differs', () => {
  const host = generateKeyPair(random)
  const other = generateKeyPair(random)
  const sealed = sealHook(hook, hex(host.publicKey), random)
  expect(openHook(sealed, host.secret, host.publicKey)).toEqual(hook)
  expect(openHook(sealed, other.secret, other.publicKey)).toBeNull()
  expect(sealHook(hook, hex(host.publicKey), random)).not.toBe(sealed)
  expect(sealed).not.toContain('x-github-event')
  const tampered = sealed.slice(0, -2) + (sealed.endsWith('00') ? '11' : '00')
  expect(openHook(tampered, host.secret, host.publicKey)).toBeNull()
})

it('keeps the sender’s headers but not credentials or Cloudflare’s own', () => {
  expect(
    hookHeaders([
      ['X-Hub-Signature-256', 'sha256=1'],
      ['Authorization', 'Bearer x'],
      ['Cookie', 'a=b'],
      ['CF-Connecting-IP', '1.2.3.4'],
    ]),
  ).toEqual({ 'x-hub-signature-256': 'sha256=1' })
})

it('frames a hook on stream 0', () => {
  expect(decodeMux(encodeMux(MUX.hook, 0, new Uint8Array([1])))).toMatchObject({ type: MUX.hook, stream: 0 })
})
