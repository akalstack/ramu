// Noise_NX_25519_ChaChaPoly_SHA256 (https://noiseprotocol.org/noise.html), the handshake every Ramu Link stream runs
// inside the relay. The device (initiator) has no static key; the host (responder) proves its long-lived identity key,
// which the device pins once paired. Pure TypeScript on @noble so the desktop, the server and the phone share it.
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils'

const PROTOCOL = 'Noise_NX_25519_ChaChaPoly_SHA256'
const DH_LEN = 32
const TAG_LEN = 16
/** Nonces are 64-bit counters; a stream that reaches this many records is closed rather than reusing one. */
const MAX_NONCE = 2 ** 53 - 1

export interface KeyPair {
  secret: Uint8Array
  publicKey: Uint8Array
}
export type RandomBytes = (bytes: number) => Uint8Array

export function generateKeyPair(random: RandomBytes): KeyPair {
  const secret = random(32)
  if (secret.length !== 32) throw new Error('Secure random bytes are unavailable')
  return { secret, publicKey: x25519.getPublicKey(secret) }
}
export const keyPairFromSecret = (secret: Uint8Array): KeyPair => ({ secret, publicKey: x25519.getPublicKey(secret) })

function hkdf2(chainingKey: Uint8Array, input: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmac(sha256, chainingKey, input)
  const first = hmac(sha256, temp, Uint8Array.of(1))
  return [first, hmac(sha256, temp, concatBytes(first, Uint8Array.of(2)))]
}
function nonceBytes(n: number): Uint8Array {
  const nonce = new Uint8Array(12)
  new DataView(nonce.buffer).setBigUint64(4, BigInt(n), true)
  return nonce
}

/** One direction of a finished handshake. */
export class CipherState {
  private n = 0
  constructor(private readonly key: Uint8Array) {}
  encrypt(plaintext: Uint8Array, ad: Uint8Array = new Uint8Array()): Uint8Array {
    if (this.n >= MAX_NONCE) throw new Error('Link stream exhausted its nonces')
    return chacha20poly1305(this.key, nonceBytes(this.n++), ad).encrypt(plaintext)
  }
  decrypt(ciphertext: Uint8Array, ad: Uint8Array = new Uint8Array()): Uint8Array {
    if (this.n >= MAX_NONCE) throw new Error('Link stream exhausted its nonces')
    // A failed tag throws before the counter moves, so a forged record cannot desynchronize the stream.
    const plaintext = chacha20poly1305(this.key, nonceBytes(this.n), ad).decrypt(ciphertext)
    this.n++
    return plaintext
  }
}

class SymmetricState {
  private h: Uint8Array
  private ck: Uint8Array
  private cipher: CipherState | null = null
  constructor(prologue: Uint8Array) {
    const name = utf8ToBytes(PROTOCOL)
    this.h = name.length <= 32 ? concatBytes(name, new Uint8Array(32 - name.length)) : sha256(name)
    this.ck = this.h
    this.mixHash(prologue)
  }
  mixHash(data: Uint8Array) {
    this.h = sha256(concatBytes(this.h, data))
  }
  mixKey(input: Uint8Array) {
    const [ck, key] = hkdf2(this.ck, input)
    this.ck = ck
    this.cipher = new CipherState(key)
  }
  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const out = this.cipher ? this.cipher.encrypt(plaintext, this.h) : plaintext
    this.mixHash(out)
    return out
  }
  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const out = this.cipher ? this.cipher.decrypt(ciphertext, this.h) : ciphertext
    this.mixHash(ciphertext)
    return out
  }
  split(): [CipherState, CipherState] {
    const [first, second] = hkdf2(this.ck, new Uint8Array())
    return [new CipherState(first), new CipherState(second)]
  }
  get handshakeHash() {
    return this.h
  }
}

export interface Session {
  send: CipherState
  receive: CipherState
  /** Identical on both ends of one handshake; binds anything derived from it to this exact stream. */
  handshakeHash: Uint8Array
  /** The host's identity key, as proved in the handshake. */
  hostKey: Uint8Array
}

/** The device's side: `-> e`, then `<- e, ee, s, es`. */
export class Initiator {
  private state: SymmetricState
  private e: KeyPair | null = null
  constructor(
    prologue: Uint8Array,
    private readonly random: RandomBytes,
  ) {
    this.state = new SymmetricState(prologue)
  }
  /** The first message, with an optional cleartext payload. */
  start(payload: Uint8Array = new Uint8Array()): Uint8Array {
    this.e = generateKeyPair(this.random)
    this.state.mixHash(this.e.publicKey)
    return concatBytes(this.e.publicKey, this.state.encryptAndHash(payload))
  }
  /** Reads the host's answer; throws when it was not produced by the holder of the key it carries. */
  finish(message: Uint8Array): { session: Session; payload: Uint8Array } {
    if (!this.e) throw new Error('Handshake not started')
    if (message.length < DH_LEN + DH_LEN + TAG_LEN + TAG_LEN) throw new Error('Link handshake is too short')
    const re = message.subarray(0, DH_LEN)
    this.state.mixHash(re)
    this.state.mixKey(x25519.getSharedSecret(this.e.secret, re))
    const hostKey = this.state.decryptAndHash(message.subarray(DH_LEN, DH_LEN + DH_LEN + TAG_LEN))
    this.state.mixKey(x25519.getSharedSecret(this.e.secret, hostKey))
    const payload = this.state.decryptAndHash(message.subarray(DH_LEN + DH_LEN + TAG_LEN))
    const [send, receive] = this.state.split()
    return { session: { send, receive, handshakeHash: this.state.handshakeHash, hostKey }, payload }
  }
}

/** The host's side. */
export class Responder {
  private state: SymmetricState
  constructor(
    prologue: Uint8Array,
    private readonly identity: KeyPair,
    private readonly random: RandomBytes,
  ) {
    this.state = new SymmetricState(prologue)
  }
  /** Reads `-> e` and answers in one step; returns the device's cleartext payload and the finished session. */
  answer(
    message: Uint8Array,
    payload: Uint8Array = new Uint8Array(),
  ): { reply: Uint8Array; session: Session; payload: Uint8Array } {
    if (message.length < DH_LEN) throw new Error('Link handshake is too short')
    const re = message.subarray(0, DH_LEN)
    this.state.mixHash(re)
    const received = this.state.decryptAndHash(message.subarray(DH_LEN))
    const e = generateKeyPair(this.random)
    this.state.mixHash(e.publicKey)
    this.state.mixKey(x25519.getSharedSecret(e.secret, re))
    const s = this.state.encryptAndHash(this.identity.publicKey)
    this.state.mixKey(x25519.getSharedSecret(this.identity.secret, re))
    const body = this.state.encryptAndHash(payload)
    const [receive, send] = this.state.split()
    return {
      reply: concatBytes(e.publicKey, s, body),
      session: { send, receive, handshakeHash: this.state.handshakeHash, hostKey: this.identity.publicKey },
      payload: received,
    }
  }
}
