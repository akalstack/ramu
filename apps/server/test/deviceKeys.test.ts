import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deviceKey, signProof, type ProofPurpose } from '@ramu/shared/deviceProof'
import { DeviceStore, RENEWAL_OVERLAP_MS } from '../src/remote/devices'

const dirs: string[] = []
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})
const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const now = 1_800_000_000_000
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu device keys '))
  dirs.push(dir)
  const path = join(dir, 'remote-devices.json')
  const devices = new DeviceStore(path)
  const paired = devices.redeem(devices.createCode(now).code, 'phone', now)!
  devices.authenticate(`Bearer ${paired.token}`, now)
  return { path, devices, paired }
}
const proof = (secret: string, token: string, purpose: ProofPurpose, at: number) => ({
  header: signProof(secret, token, purpose, at, random),
  purpose,
})

describe('a device paired before keys', () => {
  it('keeps working with its token alone, and renews without a key as before', () => {
    const { devices, paired } = setup()
    expect(devices.authenticate(`Bearer ${paired.token}`, now + 1000)?.id).toBe(paired.device.id)
    const renewed = devices.renew(`Bearer ${paired.token}`, now + 2000)!
    expect(renewed.bound).toBe(false)
    expect(devices.authenticate(`Bearer ${renewed.token}`, now + 3000)?.id).toBe(paired.device.id)
  })

  it('binds its next token to the key it names when it renews', () => {
    const { devices, paired, path } = setup()
    const key = deviceKey(random)
    const renewed = devices.renew(`Bearer ${paired.token}`, now + 1000, { key: key.publicKey })!
    expect(renewed.bound).toBe(true)
    // Until the new token is used the old one is still the credential, with no proof to give.
    expect(devices.authenticate(`Bearer ${paired.token}`, now + 2000)?.id).toBe(paired.device.id)
    // The new token is refused on its own from its first use.
    expect(devices.authenticate(`Bearer ${renewed.token}`, now + 3000)).toBeNull()
    expect(devices.lastProofRefusal).toBe('missing')
    expect(
      devices.authenticate(
        `Bearer ${renewed.token}`,
        now + 3000,
        proof(key.secret, renewed.token, 'socket', now + 3000),
      ),
    ).toMatchObject({ id: paired.device.id })
    // The replaced token had no key, so it finishes its short overlap as it was.
    expect(devices.authenticate(`Bearer ${paired.token}`, now + 3000 + RENEWAL_OVERLAP_MS - 1)).not.toBeNull()
    expect(devices.authenticate(`Bearer ${paired.token}`, now + 3000 + RENEWAL_OVERLAP_MS + 1)).toBeNull()
    // Only the public key is kept.
    expect(readFileSync(path, 'utf8')).toContain(key.publicKey)
    expect(readFileSync(path, 'utf8')).not.toContain(key.secret)
  })

  it('ignores a key that is not one', () => {
    const { devices, paired } = setup()
    expect(devices.renew(`Bearer ${paired.token}`, now + 1000, { key: 'not-a-key' })!.bound).toBe(false)
  })
})

describe('a device bound to a key', () => {
  const bound = () => {
    const made = setup()
    const key = deviceKey(random)
    const renewed = made.devices.renew(`Bearer ${made.paired.token}`, now + 1000, { key: key.publicKey })!
    const header = `Bearer ${renewed.token}`
    made.devices.authenticate(header, now + 2000, proof(key.secret, renewed.token, 'socket', now + 2000))
    return { ...made, key, token: renewed.token, header, at: now + 2000 + RENEWAL_OVERLAP_MS + 1 }
  }

  it('refuses the token alone, another key, another purpose and a proof used twice', () => {
    const { devices, key, token, header, at } = bound()
    expect(devices.authenticate(header, at)).toBeNull()
    const thief = deviceKey(random)
    expect(devices.authenticate(header, at, proof(thief.secret, token, 'socket', at))).toBeNull()
    expect(devices.lastProofRefusal).toBe('signature')
    // The host names the purpose from the request, so a proof signed for renewing does not open a connection.
    expect(
      devices.authenticate(header, at, {
        header: signProof(key.secret, token, 'renew', at, random),
        purpose: 'socket',
      }),
    ).toBeNull()
    const once = proof(key.secret, token, 'socket', at)
    expect(devices.authenticate(header, at, once)).not.toBeNull()
    expect(devices.authenticate(header, at + 1, once)).toBeNull()
    expect(devices.lastProofRefusal).toBe('replayed')
  })

  it('tells a clock that is off from a wrong key', () => {
    const { devices, key, token, header, at } = bound()
    expect(devices.authenticate(header, at, proof(key.secret, token, 'socket', at - 60 * 60_000))).toBeNull()
    expect(devices.lastProofRefusal).toBe('stale')
  })

  it('re-checks a connection that already proved itself without a new proof', () => {
    const { devices, header, at, paired } = bound()
    expect(devices.authenticate(header, at, 'proven')?.id).toBe(paired.device.id)
    devices.revoke(paired.device.id)
    expect(devices.authenticate(header, at, 'proven')).toBeNull()
  })

  it('renews only with a proof, keeps its key, and cannot have it swapped', () => {
    const { devices, key, token, header, at, paired } = bound()
    const thief = deviceKey(random)
    // A copied token can neither renew nor bind a key of its own.
    expect(devices.renew(header, at, { key: thief.publicKey })).toBeNull()
    expect(
      devices.renew(header, at, { key: thief.publicKey, proof: signProof(thief.secret, token, 'renew', at, random) }),
    ).toBeNull()
    const next = devices.renew(header, at, {
      key: thief.publicKey,
      proof: signProof(key.secret, token, 'renew', at, random),
    })!
    expect(next.bound).toBe(true)
    const nextHeader = `Bearer ${next.token}`
    expect(devices.authenticate(nextHeader, at + 1000, proof(thief.secret, next.token, 'socket', at + 1000))).toBeNull()
    expect(
      devices.authenticate(nextHeader, at + 1000, proof(key.secret, next.token, 'socket', at + 1000)),
    ).toMatchObject({ id: paired.device.id })
    // The replaced token was bound too, so its overlap still needs the key.
    expect(devices.authenticate(header, at + 2000)).toBeNull()
    expect(devices.authenticate(header, at + 2000, proof(key.secret, token, 'socket', at + 2000))).not.toBeNull()
  })
})
