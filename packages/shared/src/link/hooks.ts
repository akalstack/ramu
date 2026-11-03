// Webhook requests through Ramu Link. A sender posts to the service's public address for a host; the service seals the
// request to that host's identity key at once, so a held request is never stored readably, and hands it to the host over
// the relay now or when the host reconnects. Only the host can open it.
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'

/** What the host gets: the address token, the sender's headers and the exact body bytes. */
export interface LinkHook {
  token: string
  headers: Record<string, string>
  /** Base64 of the raw body, so a signature over it still checks out. */
  body: string
  receivedAt: number
}

/** How long the service holds a request for a host that is offline. */
export const HOOK_HOLD_MS = 24 * 60 * 60_000
/** Held requests per host; past this the oldest go first. */
export const MAX_HELD_HOOKS = 200
/** Headers worth keeping: signatures, event names and delivery ids. Cookies, auth and Cloudflare's own are dropped. */
export function hookHeaders(headers: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of headers) {
    const key = name.toLowerCase()
    if (key === 'authorization' || key === 'cookie' || key.startsWith('cf-') || key === 'x-forwarded-for') continue
    if (Object.keys(out).length >= 40) break
    out[key] = value.slice(0, 4096)
  }
  return out
}

const LABEL = utf8ToBytes('ramu-link hook v1')
const keyOf = (shared: Uint8Array, ephemeral: Uint8Array, recipient: Uint8Array) =>
  sha256(concatBytes(LABEL, shared, ephemeral, recipient))

/**
 * Seals to a host's X25519 key: a fresh key pair per request, so nothing but the host's secret opens it. The output is
 * hex: `ephemeral public key ‖ nonce ‖ ciphertext`.
 */
export function sealHook(hook: LinkHook, hostKeyHex: string, random: (bytes: number) => Uint8Array): string {
  const recipient = hexToBytes(hostKeyHex)
  const ephemeral = random(32)
  const ephemeralPublic = x25519.getPublicKey(ephemeral)
  const key = keyOf(x25519.getSharedSecret(ephemeral, recipient), ephemeralPublic, recipient)
  const nonce = random(12)
  const sealed = chacha20poly1305(key, nonce).encrypt(utf8ToBytes(JSON.stringify(hook)))
  return bytesToHex(concatBytes(ephemeralPublic, nonce, sealed))
}

/** Null for anything not sealed to this key or not shaped like a hook. */
export function openHook(sealedHex: string, secret: Uint8Array, publicKey: Uint8Array): LinkHook | null {
  try {
    const bytes = hexToBytes(sealedHex)
    if (bytes.length < 32 + 12 + 16) return null
    const ephemeralPublic = bytes.subarray(0, 32)
    const key = keyOf(x25519.getSharedSecret(secret, ephemeralPublic), ephemeralPublic, publicKey)
    const plain = chacha20poly1305(key, bytes.subarray(32, 44)).decrypt(bytes.subarray(44))
    const value = JSON.parse(new TextDecoder().decode(plain)) as Partial<LinkHook>
    if (
      typeof value.token !== 'string' ||
      typeof value.body !== 'string' ||
      typeof value.receivedAt !== 'number' ||
      !value.headers ||
      typeof value.headers !== 'object'
    )
      return null
    return value as LinkHook
  } catch {
    return null
  }
}
