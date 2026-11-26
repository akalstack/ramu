import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PROOF_WINDOW_MS, deviceKey, isDevicePublicKey, signProof, verifyProof } from '../src/deviceProof'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const now = 1_800_000_000_000

describe('device proof', () => {
  const key = deviceKey(random)
  const token = 'a'.repeat(64)

  it('accepts a fresh proof made with the bound key for that token and purpose', () => {
    expect(isDevicePublicKey(key.publicKey)).toBe(true)
    const proof = signProof(key.secret, token, 'socket', now, random)
    expect(verifyProof(key.publicKey, token, 'socket', proof, now + 1000)).toMatchObject({ ok: true, at: now })
  })

  it('refuses another key, another token and another purpose', () => {
    const proof = signProof(key.secret, token, 'socket', now, random)
    const other = deviceKey(random)
    expect(verifyProof(other.publicKey, token, 'socket', proof, now)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyProof(key.publicKey, 'b'.repeat(64), 'socket', proof, now)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyProof(key.publicKey, token, 'renew', proof, now)).toEqual({ ok: false, reason: 'signature' })
  })

  it('refuses a proof from outside the time window, a missing one and a mangled one', () => {
    const proof = signProof(key.secret, token, 'request', now, random)
    expect(verifyProof(key.publicKey, token, 'request', proof, now + PROOF_WINDOW_MS + 1)).toEqual({
      ok: false,
      reason: 'stale',
    })
    expect(verifyProof(key.publicKey, token, 'request', proof, now - PROOF_WINDOW_MS - 1)).toEqual({
      ok: false,
      reason: 'stale',
    })
    expect(verifyProof(key.publicKey, token, 'request', undefined, now)).toEqual({ ok: false, reason: 'missing' })
    expect(verifyProof(key.publicKey, token, 'request', `${proof}.extra`, now)).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(verifyProof(key.publicKey, token, 'request', proof.replace(/^1\./, '2.'), now)).toEqual({
      ok: false,
      reason: 'malformed',
    })
    // A changed time no longer matches what was signed.
    const [version, , nonce, signature] = proof.split('.')
    expect(verifyProof(key.publicKey, token, 'request', `${version}.${now + 5}.${nonce}.${signature}`, now)).toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('needs a real source of randomness', () => {
    expect(() => deviceKey(() => new Uint8Array(0))).toThrow(/random/)
  })
})
