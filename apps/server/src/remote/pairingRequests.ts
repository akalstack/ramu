// Pairing by request, on the host (see `@ramu/shared/pairRequest`). A nearby device asks while the host is discoverable
// (or has Pair a device open); the request shows at the host only once the device has revealed the key it committed
// to, with the six-digit code both screens show. A person at the host approves it with the access it should have.
import { randomBytes, randomUUID } from 'node:crypto'
import {
  PAIR_REQUEST_TTL_MS,
  isPairKey,
  pairCommit,
  pairKeys,
  pairResultMac,
  pairSecrets,
  type PairRequestAnswer,
  type PairWaitAnswer,
} from '@ramu/shared/pairRequest'
import type { DeviceInfo, DeviceRole, DeviceStore } from './devices'

/** A few at once, so one noisy neighbour cannot block a real request; one per network address. */
const MAX_REQUESTS = 4
/** How long one wait call holds before answering "pending"; the device simply asks again. */
const WAIT_MS = 25_000
/** After a decline the same address waits this long, so a neighbour cannot keep raising the prompt. */
const DECLINED_COOLDOWN_MS = 60_000

interface Request {
  id: string
  peer: string
  name: string
  commit: string
  hostSecret: Uint8Array
  hostKey: string
  expiresAt: number
  state: 'committed' | 'revealed' | 'approved' | 'denied'
  code?: string
  token?: string
  macKey?: Uint8Array
  result?: Extract<PairWaitAnswer, { state: 'approved' }>
  waiter?: (answer: PairWaitAnswer) => void
}

/** What the host shows for a request waiting for a person: never the key or token. */
export interface PairingRequestView {
  id: string
  name: string
  address: string
  code: string
  expiresAt: number
}

export class PairingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class PairingRequests {
  private readonly requests = new Map<string, Request>()
  private readonly declined = new Map<string, number>()
  constructor(
    private readonly options: {
      devices: DeviceStore
      hostId: string
      /** Whether a device at `peer` may ask now. Defaults to while a pairing offer is open. */
      accepting?: (peer: string) => boolean
      changed?: () => void
      now?: () => number
      random?: (bytes: number) => Uint8Array
      /** This host's Link identity key, once it has one; vouched for inside the approved answer. */
      linkKey?: () => string | null
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private sweep() {
    const now = this.now()
    let removed = false
    for (const [id, request] of this.requests)
      if (request.expiresAt <= now) {
        removed ||= request.state === 'revealed'
        request.waiter?.({ state: 'expired' })
        this.requests.delete(id)
      }
    for (const [peer, until] of this.declined) if (until <= now) this.declined.delete(peer)
    if (removed) this.options.changed?.()
  }

  begin(peer: string, body: unknown): PairRequestAnswer {
    this.sweep()
    const input = body as { name?: unknown; commit?: unknown } | null
    if (typeof input?.commit !== 'string' || !/^[0-9a-f]{64}$/.test(input.commit))
      throw new PairingError(400, 'Invalid pairing request')
    const accepting = this.options.accepting?.(peer) ?? this.options.devices.offers(this.now()).length > 0
    if (!accepting)
      throw new PairingError(
        403,
        'This host is not discoverable. Turn on Discoverable in its Remote access settings, or pair with its code.',
      )
    if (this.declined.has(peer)) throw new PairingError(429, 'The host declined. Try again in a minute.')
    // A new request from the same address replaces its unanswered one.
    for (const [id, request] of this.requests)
      if (request.peer === peer && request.state !== 'approved') {
        request.waiter?.({ state: 'expired' })
        this.requests.delete(id)
      }
    if (this.requests.size >= MAX_REQUESTS) throw new PairingError(429, 'The host is busy with other requests.')
    const keys = pairKeys(this.options.random ?? ((bytes) => new Uint8Array(randomBytes(bytes))))
    const request: Request = {
      id: randomUUID(),
      peer,
      name: typeof input.name === 'string' ? input.name.slice(0, 60) : '',
      commit: input.commit,
      hostSecret: keys.secret,
      hostKey: keys.publicKey,
      expiresAt: this.now() + PAIR_REQUEST_TTL_MS,
      state: 'committed',
    }
    this.requests.set(request.id, request)
    return { requestId: request.id, hostKey: keys.publicKey, hostId: this.options.hostId, expiresAt: request.expiresAt }
  }

  reveal(peer: string, body: unknown): void {
    this.sweep()
    const input = body as { requestId?: unknown; key?: unknown } | null
    const request = typeof input?.requestId === 'string' ? this.requests.get(input.requestId) : undefined
    if (!request || request.peer !== peer) throw new PairingError(404, 'That request expired. Try again.')
    // Exactly one reveal, matching the key committed to before the host's key was sent.
    if (request.state !== 'committed' || !isPairKey(input?.key) || pairCommit(input.key) !== request.commit) {
      this.requests.delete(request.id)
      throw new PairingError(401, 'The pairing request did not match.')
    }
    const secrets = pairSecrets(request.hostSecret, input.key, {
      requestId: request.id,
      hostId: this.options.hostId,
      commit: request.commit,
      deviceKey: input.key,
      hostKey: request.hostKey,
    })
    request.state = 'revealed'
    request.code = secrets.code
    request.token = secrets.token
    request.macKey = secrets.macKey
    this.options.changed?.()
  }

  /** Requests waiting for a person at the host. */
  list(): PairingRequestView[] {
    this.sweep()
    return [...this.requests.values()].flatMap((request) =>
      request.state === 'revealed'
        ? [
            {
              id: request.id,
              name: request.name,
              address: request.peer,
              code: request.code!,
              expiresAt: request.expiresAt,
            },
          ]
        : [],
    )
  }

  /**
   * Pairs the device with the given access. It goes through a one-time offer like a typed code, so the device is
   * created in the same single write. Host-only, like the rest of pairing.
   */
  approve(id: string, access: DeviceRole): DeviceInfo {
    this.sweep()
    const request = this.requests.get(id)
    if (!request || request.state !== 'revealed') throw new Error('That request expired. Ask the device to try again.')
    const now = this.now()
    const { offerId } = this.options.devices.createCode(now, access, `request:${id}`)
    const device = this.options.devices.redeemOffer(offerId, request.name || undefined, request.token!, now)
    if (!device) throw new Error('That request expired. Ask the device to try again.')
    const linkKey = this.options.linkKey?.()
    const fields = {
      deviceId: device.id,
      role: device.role ?? ('owner' as const),
      hostId: this.options.hostId,
      expiresAt: device.expiresAt,
      ...(linkKey ? { linkKey } : {}),
    }
    request.state = 'approved'
    request.result = { state: 'approved', ...fields, mac: pairResultMac(request.macKey!, fields) }
    request.token = undefined
    request.waiter?.(request.result)
    request.waiter = undefined
    this.options.changed?.()
    return device
  }

  deny(id: string): void {
    const request = this.requests.get(id)
    if (!request || request.state === 'approved') return
    request.state = 'denied'
    request.token = undefined
    this.declined.set(request.peer, this.now() + DECLINED_COOLDOWN_MS)
    request.waiter?.({ state: 'denied' })
    request.waiter = undefined
    this.options.changed?.()
  }

  /** Answers when the person at the host decides, or `pending` after a while so the device asks again. */
  wait(peer: string, body: unknown, signal?: AbortSignal): Promise<PairWaitAnswer> {
    this.sweep()
    const input = body as { requestId?: unknown } | null
    const request = typeof input?.requestId === 'string' ? this.requests.get(input.requestId) : undefined
    if (!request || request.peer !== peer) return Promise.resolve({ state: 'expired' })
    const settled = (answer: PairWaitAnswer): PairWaitAnswer => {
      if (answer.state !== 'pending') this.requests.delete(request.id)
      return answer
    }
    if (request.state === 'approved') return Promise.resolve(settled(request.result!))
    if (request.state === 'denied') return Promise.resolve(settled({ state: 'denied' }))
    // One waiter per request: an older wait gives way.
    request.waiter?.({ state: 'pending' })
    return new Promise((resolve) => {
      const finish = (answer: PairWaitAnswer) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        if (request.waiter === finish) request.waiter = undefined
        resolve(settled(answer))
      }
      const aborted = () => finish({ state: 'pending' })
      const timer = setTimeout(() => finish({ state: 'pending' }), Math.min(WAIT_MS, request.expiresAt - this.now()))
      signal?.addEventListener('abort', aborted)
      request.waiter = finish
    })
  }
}
