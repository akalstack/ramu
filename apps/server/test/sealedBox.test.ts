import { blake2b } from '@noble/hashes/blake2b'
import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { sealedBox } from '../src/workspace/forge/sealedBox'

/** crypto_box_seal_open, as GitHub runs it with the repository's private key. */
function open(sealed: string, keys: nacl.BoxKeyPair): string | null {
  const bytes = Buffer.from(sealed, 'base64')
  const ephemeral = bytes.subarray(0, nacl.box.publicKeyLength)
  const nonce = blake2b(new Uint8Array([...ephemeral, ...keys.publicKey]), { dkLen: nacl.box.nonceLength })
  const opened = nacl.box.open(bytes.subarray(nacl.box.publicKeyLength), nonce, ephemeral, keys.secretKey)
  return opened ? new TextDecoder().decode(opened) : null
}

describe('sealedBox', () => {
  it('opens only with the recipient’s private key, and differs every time', () => {
    const keys = nacl.box.keyPair()
    const publicKey = Buffer.from(keys.publicKey).toString('base64')
    const first = sealedBox('sk_live_123', publicKey)
    expect(open(first, keys)).toBe('sk_live_123')
    expect(sealedBox('sk_live_123', publicKey)).not.toBe(first)
    expect(open(first, nacl.box.keyPair())).toBeNull()
    expect(Buffer.from(first, 'base64').length).toBe(32 + 16 + 'sk_live_123'.length)
  })

  it('refuses a key of the wrong size', () => {
    expect(() => sealedBox('x', Buffer.from('short').toString('base64'))).toThrow('public key')
  })
})
