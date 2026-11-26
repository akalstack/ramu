import { PROOF_HEADER, deviceKey, signProof, type DeviceKey, type ProofPurpose } from '@ramu/shared/deviceProof'

export { PROOF_HEADER, deviceKey, type DeviceKey }

/** Signs the proof a host asks for with a key-bound token, and reads a host's clock when this device's is off. */
export interface Prover {
  readonly publicKey: string
  header(token: string, purpose: ProofPurpose): string
  /** Learns how far this device's clock is from the host's. Safe to call after any refused connection. */
  sync(address: string): Promise<void>
}

/** A host's clock is read at most this often, however many connections fail. */
const SYNC_EVERY_MS = 30_000

/**
 * This device's key, used for every host it is paired with. A proof carries the time, and a device whose clock is
 * wrong would be refused by every host, so after a refusal the prover reads the host's clock from its health answer
 * (the `Date` every HTTP response carries) and signs with that from then on.
 */
export class DeviceProver implements Prover {
  private offsetMs = 0
  private syncedAt = 0
  constructor(
    private readonly key: DeviceKey,
    private readonly random: (bytes: number) => Uint8Array,
    private readonly now: () => number = Date.now,
    private readonly fetcher: typeof globalThis.fetch = (...args) => globalThis.fetch(...args),
  ) {}

  get publicKey(): string {
    return this.key.publicKey
  }

  header(token: string, purpose: ProofPurpose): string {
    return signProof(this.key.secret, token, purpose, this.now() + this.offsetMs, this.random)
  }

  async sync(address: string): Promise<void> {
    const started = this.now()
    if (this.syncedAt && started - this.syncedAt < SYNC_EVERY_MS) return
    this.syncedAt = started
    try {
      const url = new URL('/health', address.replace(/^ws/, 'http'))
      const response = await this.fetcher(url.toString(), { method: 'GET' })
      const host = Date.parse(response.headers.get('date') ?? '')
      // The header counts whole seconds and the answer took a moment: only a difference worth correcting is kept.
      if (Number.isFinite(host)) {
        const offset = host - (started + this.now()) / 2
        this.offsetMs = Math.abs(offset) > 30_000 ? offset : 0
      }
    } catch {
      // Out of reach: the next refusal asks again.
      this.syncedAt = 0
    }
  }
}

let shared: Prover | null = null
/** The key this process proves its tokens with, set once at startup by an app that holds one. */
export function setDeviceProver(prover: Prover | null): void {
  shared = prover
}
export const deviceProver = (): Prover | null => shared
