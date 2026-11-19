import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PairBackInvite } from '@ramu/shared/types'
import type { DeviceInfo } from './devices'

/** No longer than a pairing code lives on the computer that made it. */
const MAX_LIFETIME_MS = 15 * 60_000

const address = z
  .string()
  .max(500)
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), 'Use an http or https address')

const pairBackInput = z.object({
  name: z.string().trim().min(1).max(80),
  urls: z.array(address).min(1).max(12),
  code: z.string().regex(/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/),
  expiresAt: z.number().int(),
})

/**
 * Paired computers inviting this host to connect back to them, waiting for the person here. One per device: a new
 * invitation replaces that device's earlier one, and an invitation lapses with its code.
 */
export class PairBackInvites {
  private readonly invites = new Map<string, PairBackInvite>()
  constructor(
    private readonly now: () => number = Date.now,
    /** Told the waiting invitations whenever one is added or answered, so the person here sees it at once. */
    private readonly changed: (invites: PairBackInvite[]) => void = () => {},
  ) {}

  private sweep() {
    for (const [id, invite] of this.invites) if (invite.expiresAt <= this.now()) this.invites.delete(id)
  }

  invite(device: DeviceInfo, input: unknown): void {
    if (device.role === 'viewer' || device.kind === 'host')
      throw new Error('Only a computer paired with full access can invite this host.')
    const { name, urls, code, expiresAt } = pairBackInput.parse(input)
    if (expiresAt <= this.now() || expiresAt > this.now() + MAX_LIFETIME_MS)
      throw new Error('That invitation has expired. Send a new one.')
    this.sweep()
    for (const [id, invite] of this.invites) if (invite.deviceId === device.id) this.invites.delete(id)
    const id = randomUUID()
    this.invites.set(id, { id, deviceId: device.id, name, urls, code, expiresAt })
    this.changed(this.list())
  }

  list(): PairBackInvite[] {
    this.sweep()
    return [...this.invites.values()]
  }

  dismiss(id: string): void {
    if (this.invites.delete(id)) this.changed(this.list())
  }

  /** A device that is revoked here can no longer be invited to. */
  forget(deviceId: string): void {
    let removed = false
    for (const [id, invite] of this.invites)
      if (invite.deviceId === deviceId) removed = this.invites.delete(id) || removed
    if (removed) this.changed(this.list())
  }
}
