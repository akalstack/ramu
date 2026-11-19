// libsodium's sealed box (crypto_box_seal), which GitHub requires for Actions secrets: an ephemeral X25519 key, a
// nonce from BLAKE2b of both public keys, and XSalsa20-Poly1305. Only the repository's private key can open it.
import { blake2b } from '@noble/hashes/blake2.js'
import nacl from 'tweetnacl'

/** Seals `message` to a base64 public key and returns base64, as GitHub's secrets API takes it. */
export function sealedBox(message: string, publicKey: string): string {
  const recipient = Buffer.from(publicKey, 'base64')
  if (recipient.length !== nacl.box.publicKeyLength) throw new Error('GitHub sent a public key Ramu cannot use.')
  const ephemeral = nacl.box.keyPair()
  const nonce = blake2b(new Uint8Array([...ephemeral.publicKey, ...recipient]), { dkLen: nacl.box.nonceLength })
  const sealed = nacl.box(new TextEncoder().encode(message), nonce, recipient, ephemeral.secretKey)
  return Buffer.concat([ephemeral.publicKey, sealed]).toString('base64')
}
