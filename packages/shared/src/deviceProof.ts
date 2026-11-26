// Proof that the device presenting a token also holds the key the token was bound to. A device makes an Ed25519 key,
// keeps the secret in its own secure storage and gives the host the public half when it renews its token. From then on
// the host accepts that token only with a fresh signature, so a token copied out of a backup, a log or a relay is
// useless on its own. Devices paired before this keep working with the token alone until their next renewal.
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export const PROOF_HEADER = 'x-ramu-proof'
/** How far a proof's time may be from the host's clock, either way. Within it, a proof is accepted once. */
export const PROOF_WINDOW_MS = 5 * 60_000

/** What a proof is for, so one made for a connection cannot renew a token. */
export type ProofPurpose = 'socket' | 'renew' | 'request'

export interface DeviceKey {
  /** Never leaves the device. */
  secret: string
  publicKey: string
}

const KEY = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{16,64}$/
export const isDevicePublicKey = (value: unknown): value is string => typeof value === 'string' && KEY.test(value)

/** `random` must be a cryptographically secure source; there is deliberately no fallback. */
export function deviceKey(random: (bytes: number) => Uint8Array): DeviceKey {
  const secret = random(32)
  if (secret.length !== 32) throw new Error('Secure random bytes are unavailable')
  return { secret: bytesToHex(secret), publicKey: bytesToHex(ed25519.getPublicKey(secret)) }
}

/** The token is named by its hash, so a proof never repeats the secret it accompanies. */
const message = (token: string, purpose: ProofPurpose, at: number, nonce: string) =>
  utf8ToBytes(`ramu-device-proof:1\n${purpose}\n${at}\n${nonce}\n${bytesToHex(sha256(utf8ToBytes(token)))}`)

/** The header value proving `token` is used by the holder of `secret`, now, for `purpose`. */
export function signProof(
  secret: string,
  token: string,
  purpose: ProofPurpose,
  at: number,
  random: (bytes: number) => Uint8Array,
): string {
  const nonce = bytesToHex(random(12))
  const signature = ed25519.sign(message(token, purpose, at, nonce), hexToBytes(secret))
  return `1.${at}.${nonce}.${bytesToHex(signature)}`
}

export type ProofCheck =
  | { ok: true; nonce: string; at: number }
  /** `stale` is a clock too far from the host's: the device can correct for it and try again. */
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'signature' }

/** Checks a proof against the key a token is bound to. The caller refuses a nonce it has already accepted. */
export function verifyProof(
  publicKey: string,
  token: string,
  purpose: ProofPurpose,
  header: string | undefined,
  now: number,
): ProofCheck {
  if (!header) return { ok: false, reason: 'missing' }
  const [version, time, nonce, signature, ...rest] = header.split('.')
  const at = Number(time)
  if (
    version !== '1' ||
    rest.length ||
    !Number.isSafeInteger(at) ||
    !nonce ||
    !NONCE.test(nonce) ||
    !signature ||
    !/^[0-9a-f]{128}$/.test(signature)
  )
    return { ok: false, reason: 'malformed' }
  if (Math.abs(now - at) > PROOF_WINDOW_MS) return { ok: false, reason: 'stale' }
  try {
    if (!ed25519.verify(hexToBytes(signature), message(token, purpose, at, nonce), hexToBytes(publicKey)))
      return { ok: false, reason: 'signature' }
  } catch {
    return { ok: false, reason: 'signature' }
  }
  return { ok: true, nonce, at }
}
