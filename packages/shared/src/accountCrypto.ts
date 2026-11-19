// The cryptography behind settings backups that only the person's own devices can read. A host keeps a random 256-bit
// backup key; each backup is sealed with XChaCha20-Poly1305 under it before upload, so the account service stores
// ciphertext only. A new device gets the key from a device that has it through an X25519 exchange the service relays:
// the new device commits to its key first, both screens show the same six-digit number, and only then is the key sent,
// sealed to the new device. A recovery code opens a copy of the key kept on the service sealed under the code.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export type Random = (bytes: number) => Uint8Array

const VERSION = 1
/** Flags in a sealed backup's header. */
export const SEALED_DEFLATE = 1

function secure(random: Random, length: number): Uint8Array {
  const bytes = random(length)
  if (bytes.length !== length) throw new Error('Secure random bytes are unavailable')
  return bytes
}

export function newBackupKey(random: Random): Uint8Array {
  return secure(random, 32)
}

/**
 * `[version][flags][24-byte nonce][ciphertext]`. `context` is bound as associated data, so a backup sealed for one
 * slot cannot be passed off as another's.
 */
export function seal(key: Uint8Array, plaintext: Uint8Array, random: Random, context: string, flags = 0): Uint8Array {
  if (key.length !== 32) throw new Error('A backup key is 32 bytes')
  const nonce = secure(random, 24)
  const sealed = xchacha20poly1305(key, nonce, utf8ToBytes(`ramu-backup:${VERSION}:${context}`)).encrypt(plaintext)
  const out = new Uint8Array(2 + 24 + sealed.length)
  out[0] = VERSION
  out[1] = flags
  out.set(nonce, 2)
  out.set(sealed, 26)
  return out
}

export class SealError extends Error {}

/** Opens what `seal` made; a wrong key, another context or a changed byte is refused in plain words. */
export function open(key: Uint8Array, sealed: Uint8Array, context: string): { plaintext: Uint8Array; flags: number } {
  if (sealed.length < 26 + 16 || sealed[0] !== VERSION)
    throw new SealError('This backup was not made by this version of Ramu.')
  try {
    const plaintext = xchacha20poly1305(
      key,
      sealed.slice(2, 26),
      utf8ToBytes(`ramu-backup:${VERSION}:${context}`),
    ).decrypt(sealed.slice(26))
    return { plaintext, flags: sealed[1]! }
  } catch {
    throw new SealError('This backup cannot be opened with this key. It was changed, or the key is another one.')
  }
}

// ---- Recovery codes ----

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A 160-bit code in eight groups of four, such as `7Q4M-…`, written in Crockford's base 32 (no I, L, O or U). */
export function newRecoveryCode(random: Random): string {
  const bytes = secure(random, 20)
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < 32) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

/** The code as typed back: case, spaces and the letters people mistake for digits are forgiven. */
export function normalizeRecoveryCode(input: string): string | null {
  const plain = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{32}$/.test(plain) ? plain.match(/.{4}/g)!.join('-') : null
}

/** The key a recovery code seals the backup key under. The code carries 160 random bits, so no slow hash is needed. */
export function recoveryKey(code: string): Uint8Array {
  const normalized = normalizeRecoveryCode(code)
  if (!normalized) throw new SealError('That is not a recovery code. Check it and try again.')
  return hkdf(sha256, utf8ToBytes(normalized), undefined, utf8ToBytes('ramu-recovery:1'), 32)
}

// ---- Approving a new device ----

export interface ExchangeKeys {
  secret: Uint8Array
  publicKey: string
}

export function exchangeKeys(random: Random): ExchangeKeys {
  const secret = secure(random, 32)
  return { secret, publicKey: bytesToHex(x25519.getPublicKey(secret)) }
}

export const exchangeCommit = (publicKey: string): string =>
  bytesToHex(sha256(utf8ToBytes(`ramu-key-commit:1:${publicKey}`)))

/** The six-digit number both screens show, and the key the backup key is sealed with, for one request. */
export function exchangeSecrets(
  secret: Uint8Array,
  peerKey: string,
  transcript: { requestId: string; commit: string; requesterKey: string; approverKey: string },
): { code: string; key: Uint8Array } {
  if (![peerKey, transcript.requesterKey, transcript.approverKey].every((key) => /^[0-9a-f]{64}$/.test(key)))
    throw new SealError('Invalid key')
  if (exchangeCommit(transcript.requesterKey) !== transcript.commit)
    throw new SealError('The request changed after it was made. Ask again from the new device.')
  let shared: Uint8Array
  try {
    shared = x25519.getSharedSecret(secret, hexToBytes(peerKey))
  } catch {
    throw new SealError('Invalid key')
  }
  if (shared.every((byte) => byte === 0)) throw new SealError('Invalid key')
  const { requestId, commit, requesterKey, approverKey } = transcript
  const okm = hkdf(
    sha256,
    shared,
    undefined,
    utf8ToBytes(`ramu-key:1:${requestId}:${commit}:${requesterKey}:${approverKey}`),
    36,
  )
  const digits = String(new DataView(okm.buffer, okm.byteOffset, 4).getUint32(0) % 1_000_000).padStart(6, '0')
  return { code: `${digits.slice(0, 3)} ${digits.slice(3)}`, key: okm.slice(4) }
}

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
