import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  SealError,
  exchangeCommit,
  exchangeKeys,
  exchangeSecrets,
  newBackupKey,
  newRecoveryCode,
  normalizeRecoveryCode,
  open,
  recoveryKey,
  seal,
} from '../src/accountCrypto'

const random = (n: number) => new Uint8Array(randomBytes(n))
const text = (value: string) => new TextEncoder().encode(value)

describe('sealed backups', () => {
  it('round-trips, and refuses another key, another slot or a changed byte', () => {
    const key = newBackupKey(random)
    const sealed = seal(key, text('{"accent":"teal"}'), random, 'slot-1')
    expect(new TextDecoder().decode(open(key, sealed, 'slot-1').plaintext)).toBe('{"accent":"teal"}')
    expect(() => open(newBackupKey(random), sealed, 'slot-1')).toThrow(SealError)
    expect(() => open(key, sealed, 'slot-2')).toThrow(SealError)
    const tampered = sealed.slice()
    tampered[40] = tampered[40]! ^ 1
    expect(() => open(key, tampered, 'slot-1')).toThrow(SealError)
    // The service sees no setting name or value.
    expect(Buffer.from(sealed).toString('latin1')).not.toContain('accent')
  })
})

describe('recovery codes', () => {
  it('reads a code back however it is typed, and refuses a wrong one', () => {
    const code = newRecoveryCode(random)
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(recoveryKey(code)).toEqual(recoveryKey(code.toLowerCase()))
    expect(() => recoveryKey('not a code')).toThrow(SealError)
    const key = newBackupKey(random)
    const kept = seal(recoveryKey(code), key, random, 'recovery')
    expect(open(recoveryKey(code), kept, 'recovery').plaintext).toEqual(key)
    expect(() => open(recoveryKey(newRecoveryCode(random)), kept, 'recovery')).toThrow(SealError)
  })
})

describe('approving a new device', () => {
  it('shows the same number on both sides and hands over the key', () => {
    const requester = exchangeKeys(random)
    const approver = exchangeKeys(random)
    const transcript = {
      requestId: 'r1',
      commit: exchangeCommit(requester.publicKey),
      requesterKey: requester.publicKey,
      approverKey: approver.publicKey,
    }
    const mine = exchangeSecrets(requester.secret, approver.publicKey, transcript)
    const theirs = exchangeSecrets(approver.secret, requester.publicKey, transcript)
    expect(mine.code).toMatch(/^\d{3} \d{3}$/)
    expect(mine).toEqual(theirs)
    const backup = newBackupKey(random)
    expect(open(mine.key, seal(theirs.key, backup, random, 'key:r1'), 'key:r1').plaintext).toEqual(backup)
  })

  it('refuses a key that was not the one committed to', () => {
    const requester = exchangeKeys(random)
    const swapped = exchangeKeys(random)
    const approver = exchangeKeys(random)
    expect(() =>
      exchangeSecrets(approver.secret, swapped.publicKey, {
        requestId: 'r1',
        commit: exchangeCommit(requester.publicKey),
        requesterKey: swapped.publicKey,
        approverKey: approver.publicKey,
      }),
    ).toThrow(/changed after it was made/)
  })
})
