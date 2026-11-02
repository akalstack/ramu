// The sealed record layer of a Link stream. Messages are split into records that each fit one relay frame; every record
// is authenticated and numbered by its nonce, so the relay can neither read, reorder, drop silently nor splice them.
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { MAX_FRAME_BYTES, linkPrologue } from './protocol'
import { Initiator, Responder, type KeyPair, type RandomBytes, type Session } from './noise'

/** The largest message a stream reassembles; the host's own request limit applies on top. */
export const MAX_LINK_MESSAGE = 16_000_000
const RECORD_PLAINTEXT = MAX_FRAME_BYTES - 64
const MORE = 1
const FINAL = 0

export class SecureChannel {
  private parts: Uint8Array[] = []
  private size = 0
  constructor(private readonly session: Session) {}

  get hostKey() {
    return bytesToHex(this.session.hostKey)
  }

  /** One message as records, in order. */
  seal(message: Uint8Array): Uint8Array[] {
    if (message.length > MAX_LINK_MESSAGE) throw new Error('Message is too large for Link')
    const records: Uint8Array[] = []
    let offset = 0
    do {
      const chunk = message.subarray(offset, offset + RECORD_PLAINTEXT)
      offset += chunk.length
      const plaintext = new Uint8Array(chunk.length + 1)
      plaintext[0] = offset < message.length ? MORE : FINAL
      plaintext.set(chunk, 1)
      records.push(this.session.send.encrypt(plaintext))
    } while (offset < message.length)
    return records
  }

  /** A whole message once its final record arrives, otherwise null. Throws on a forged or oversized stream. */
  open(record: Uint8Array): Uint8Array | null {
    const plaintext = this.session.receive.decrypt(record)
    if (plaintext.length < 1 || (plaintext[0] !== MORE && plaintext[0] !== FINAL))
      throw new Error('Invalid Link record')
    const body = plaintext.subarray(1)
    this.size += body.length
    if (this.size > MAX_LINK_MESSAGE) throw new Error('Message is too large for Link')
    this.parts.push(body)
    if (plaintext[0] === MORE) return null
    const message = new Uint8Array(this.size)
    let offset = 0
    for (const part of this.parts) {
      message.set(part, offset)
      offset += part.length
    }
    this.parts = []
    this.size = 0
    return message
  }
}

/** The device's half: the first frame it sends, then the host's answer finishes the handshake. */
export function initiateLink(hostId: string, random: RandomBytes) {
  const initiator = new Initiator(linkPrologue(hostId), random)
  return {
    hello: initiator.start(),
    /** `pinned` is the host key saved at pairing; a stream proving any other key is refused. */
    finish(reply: Uint8Array, pinned?: string | null): SecureChannel {
      const { session } = initiator.finish(reply)
      if (pinned && bytesToHex(session.hostKey) !== pinned.toLowerCase())
        throw new Error('This host’s Link identity changed. Pair it again before connecting through Link.')
      return new SecureChannel(session)
    },
  }
}

/** The host's half, answering one device's first frame. */
export function answerLink(hostId: string, identity: KeyPair, hello: Uint8Array, random: RandomBytes) {
  const { reply, session } = new Responder(linkPrologue(hostId), identity, random).answer(hello)
  return { reply, channel: new SecureChannel(session) }
}

export const hostKeyHex = (identity: KeyPair) => bytesToHex(identity.publicKey)
export const hostKeyBytes = (hex: string) => hexToBytes(hex)
