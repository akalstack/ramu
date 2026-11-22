// Pairing by request: a device near the host asks to pair, and a person at the host approves it after checking that
// both screens show the same six-digit code. The two sides run an X25519 exchange; the device commits to its key
// before it sees the host's, so someone relaying between them cannot choose keys that make the codes agree (a relay
// matches with probability one in a million per attempt, and every attempt needs the person to approve). Both sides
// derive the device token from the exchange, so the token never crosses the network.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** Each is a JSON `POST`, accepted only while the host has an unused pairing offer. */
export const PAIR_REQUEST_PATH = '/pair/request'
export const PAIR_REVEAL_PATH = '/pair/reveal'
export const PAIR_WAIT_PATH = '/pair/wait'
export interface PairRequestAnswer {
  requestId: string
  hostKey: string
  hostId: string
  expiresAt: number
}
/** `mac` binds the approved fields to this exchange. */
export type PairWaitAnswer =
  | { state: 'pending' | 'denied' | 'expired' }
  | {
      state: 'approved'
      deviceId: string
      role: 'owner' | 'viewer'
      hostId: string
      expiresAt: number | null
      mac: string
      /**
       * The host's addresses, sealed under a key only this exchange's two sides hold, when the request came through the
       * account service: the device has no address yet, and the service must not learn one.
       */
      addresses?: string
    }

/** How long a request waits for the person at the host. */
export const PAIR_REQUEST_TTL_MS = 2 * 60_000
const KEY = /^[0-9a-f]{64}$/
export const isPairKey = (value: unknown): value is string => typeof value === 'string' && KEY.test(value)

export interface PairKeys {
  secret: Uint8Array
  publicKey: string
}
/** `random` must be a cryptographically secure source; there is deliberately no fallback. */
export function pairKeys(random: (bytes: number) => Uint8Array): PairKeys {
  const secret = random(32)
  if (secret.length !== 32) throw new Error('Secure random bytes are unavailable')
  return { secret, publicKey: bytesToHex(x25519.getPublicKey(secret)) }
}

export const pairCommit = (publicKey: string): string =>
  bytesToHex(sha256(utf8ToBytes(`ramu-pair-commit:1:${publicKey}`)))

/** Everything both sides saw; the code, token and result check are all bound to it. */
export interface PairTranscript {
  requestId: string
  hostId: string
  commit: string
  deviceKey: string
  hostKey: string
}

export interface PairSecrets {
  /** Six digits, shown as `123 456` on both screens. */
  code: string
  /** The device's bearer token, in the same form as a code-paired token. */
  token: string
  macKey: Uint8Array
}

export function pairSecrets(secret: Uint8Array, peerKey: string, transcript: PairTranscript): PairSecrets {
  if (!isPairKey(peerKey) || !isPairKey(transcript.deviceKey) || !isPairKey(transcript.hostKey))
    throw new Error('Invalid pairing key')
  let shared: Uint8Array
  try {
    shared = x25519.getSharedSecret(secret, hexToBytes(peerKey))
  } catch {
    throw new Error('Invalid pairing key')
  }
  // A low-order peer key yields all zeros, which would make the result independent of this side's secret.
  if (shared.every((byte) => byte === 0)) throw new Error('Invalid pairing key')
  const { requestId, hostId, commit, deviceKey, hostKey } = transcript
  const info = utf8ToBytes(`ramu-pair:1:${requestId}:${hostId}:${commit}:${deviceKey}:${hostKey}`)
  const okm = hkdf(sha256, shared, undefined, info, 4 + 32 + 32)
  const number = new DataView(okm.buffer, okm.byteOffset, 4).getUint32(0) % 1_000_000
  const digits = String(number).padStart(6, '0')
  return {
    code: `${digits.slice(0, 3)} ${digits.slice(3)}`,
    token: bytesToHex(okm.slice(4, 36)),
    macKey: okm.slice(36),
  }
}

type Approved = Extract<PairWaitAnswer, { state: 'approved' }>
export const pairResultMac = (macKey: Uint8Array, result: Omit<Approved, 'state' | 'mac'>): string =>
  bytesToHex(
    hmac(
      sha256,
      macKey,
      utf8ToBytes(
        `ramu-pair-result:1:${result.deviceId}:${result.role}:${result.hostId}:${result.expiresAt ?? 'never'}`,
      ),
    ),
  )

export interface PairByRequestResult {
  deviceId: string
  token: string
  hostId: string
  role: 'owner' | 'viewer'
  expiresAt: number | null
  /** The host's addresses, when it sent them sealed (a request relayed by the account service). */
  addresses?: string[]
}

const addressKey = (macKey: Uint8Array) => hkdf(sha256, macKey, undefined, utf8ToBytes('ramu-pair-addresses:1'), 32)

/** The host's side: its addresses sealed for the device that ran this exchange. */
export function sealAddresses(macKey: Uint8Array, addresses: string[], random: (bytes: number) => Uint8Array): string {
  const nonce = random(24)
  const sealed = xchacha20poly1305(addressKey(macKey), nonce).encrypt(
    utf8ToBytes(JSON.stringify(addresses.slice(0, 20))),
  )
  return bytesToHex(new Uint8Array([...nonce, ...sealed]))
}

function openAddresses(macKey: Uint8Array, sealed: string): string[] {
  const bytes = hexToBytes(sealed)
  const plain = xchacha20poly1305(addressKey(macKey), bytes.slice(0, 24)).decrypt(bytes.slice(24))
  const list = JSON.parse(new TextDecoder().decode(plain)) as unknown
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : []
}

/** One JSON POST to the host; returns the status and parsed body (null when there is none). */
export type PairPost = (path: string, body: unknown, signal: AbortSignal) => Promise<{ status: number; body: unknown }>

/**
 * The device side. `onCode` runs once the code is known, to show it; the promise settles when the person at the host
 * answers. Rejects with the host's own message when it refuses.
 */
export async function requestPairing(input: {
  post: PairPost
  name: string
  random: (bytes: number) => Uint8Array
  onCode(code: string, expiresAt: number): void
  signal: AbortSignal
}): Promise<PairByRequestResult> {
  const keys = pairKeys(input.random)
  const commit = pairCommit(keys.publicKey)
  const failure = (answer: { status: number; body: unknown }) => {
    const message = (answer.body as { error?: unknown } | null)?.error
    return new Error(typeof message === 'string' ? message : `The host refused the request (${answer.status}).`)
  }
  const begun = await input.post(PAIR_REQUEST_PATH, { name: input.name, commit }, input.signal)
  if (begun.status !== 200) throw failure(begun)
  const answer = begun.body as PairRequestAnswer
  if (
    !answer ||
    typeof answer.requestId !== 'string' ||
    !isPairKey(answer.hostKey) ||
    typeof answer.hostId !== 'string'
  )
    throw new Error('The host sent an invalid pairing answer.')
  const secrets = pairSecrets(keys.secret, answer.hostKey, {
    requestId: answer.requestId,
    hostId: answer.hostId,
    commit,
    deviceKey: keys.publicKey,
    hostKey: answer.hostKey,
  })
  const revealed = await input.post(
    PAIR_REVEAL_PATH,
    { requestId: answer.requestId, key: keys.publicKey },
    input.signal,
  )
  if (revealed.status !== 200) throw failure(revealed)
  input.onCode(secrets.code, answer.expiresAt)
  while (!input.signal.aborted) {
    const waited = await input.post(PAIR_WAIT_PATH, { requestId: answer.requestId }, input.signal)
    if (waited.status !== 200) throw failure(waited)
    const result = waited.body as PairWaitAnswer
    if (result?.state === 'approved') {
      const fields = {
        deviceId: result.deviceId,
        role: result.role,
        hostId: result.hostId,
        expiresAt: result.expiresAt,
      }
      // Only the host that ran this exchange can produce the check; a tampered answer is refused.
      if (result.hostId !== answer.hostId || result.mac !== pairResultMac(secrets.macKey, fields))
        throw new Error('The host’s answer did not match this pairing.')
      let addresses: string[] | undefined
      if (typeof result.addresses === 'string')
        try {
          addresses = openAddresses(secrets.macKey, result.addresses)
        } catch {
          throw new Error('The host’s answer did not match this pairing.')
        }
      return { ...fields, token: secrets.token, ...(addresses ? { addresses } : {}) }
    }
    if (result?.state === 'denied') throw new Error('The host declined this device.')
    // The host decides expiry; this device's clock may differ from the host's.
    if (result?.state === 'expired') throw new Error('The request expired. Try again.')
  }
  throw new Error('Pairing was cancelled.')
}
