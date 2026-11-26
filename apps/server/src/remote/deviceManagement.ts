// Managing this host's devices from another paired device: the phone in a person's pocket can remove a lost laptop or
// connect a new tablet without walking to the host. The host's Settings and `ramu devices` stay the full control; this
// is the part a full-access device with the settings permission may do, each change recorded and announced here.
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { DeviceChange, NetworkStatus, PairingOffer } from '@ramu/shared/types'
import type { DeviceInfo, DeviceRole, OfferStatus } from './devices'
import { hostNameInput } from './hostName'

const KEEP = 50
/** Codes devices made, kept for following them; the store caps pending ones well below this. */
const MAX_TRACKED_OFFERS = 20

/** A change before it is recorded: each kind keeps its own fields. */
type Unrecorded<Change> = Change extends unknown ? Omit<Change, 'id' | 'at'> : never
type NewChange = Unrecorded<DeviceChange>

/** The record of changes paired devices made here, kept on disk so it outlives a restart, newest first. */
export class DeviceChanges {
  constructor(
    private readonly path: string,
    private readonly announce: (change: DeviceChange) => void,
    private readonly now: () => number = Date.now,
  ) {}

  list(): DeviceChange[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is DeviceChange =>
              !!entry &&
              typeof entry === 'object' &&
              typeof entry.id === 'string' &&
              typeof entry.at === 'number' &&
              typeof entry.by === 'string' &&
              typeof entry.action === 'string',
          )
        : []
    } catch {
      // A damaged record must not stop devices being managed; the next change starts it again.
      return []
    }
  }

  record(change: NewChange): DeviceChange {
    const entry = { ...change, id: randomUUID(), at: this.now() } as DeviceChange
    const next = [entry, ...this.list()].slice(0, KEEP)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.path)
    this.announce(entry)
    return entry
  }
}

/** The paired phones and computers a "Remove others" ends: never a linked host, never the device that asks. */
export const othersOf = (devices: DeviceInfo[], keep?: string): DeviceInfo[] =>
  devices.filter((device) => device.kind !== 'host' && device.id !== keep)

export interface DeviceManagementHost {
  devices: {
    list(): DeviceInfo[]
    revoke(id: string): DeviceInfo[]
    rename(id: string, name: string | null): DeviceInfo
    offerStatus(id: string): OfferStatus
  }
  /** The host's status, as its own Settings reads it. */
  status(): NetworkStatus
  /** A new one-time code, the same as the host's own Connect a device makes. */
  pair(role: DeviceRole, owner: string): Promise<PairingOffer> | PairingOffer
  cancelOffer(id: string): boolean
  /** Nearby devices waiting to pair, by the name each gave. */
  requests(): { id: string; name: string }[]
  approve(requestId: string, access: DeviceRole): DeviceInfo
  deny(requestId: string): void
  /** Ends what the removed devices still hold here: open connections, forwards, invitations. */
  removed(ids: string[]): void
  changes: DeviceChanges
}

const id = z.string().min(1).max(100)
const role = z.enum(['owner', 'viewer'])

/**
 * Device management for a paired device. The host already checked the device's role and settings permission before
 * the call gets here; this checks them again, bounds every argument, and keeps the rest of the guard rails: a device
 * names others by their exact id, never "all" or a prefix; it cannot touch a linked host or this computer itself (which
 * is no paired device); it may remove itself; and it follows only the pairing codes it made.
 */
export class RemoteDeviceManagement {
  /** Codes paired devices made: who made each, and whether the device that used it was announced. */
  private readonly offers = new Map<string, { byId: string; announced?: true }>()
  constructor(private readonly host: DeviceManagementHost) {}

  async invoke(caller: DeviceInfo, method: string, args: unknown[]): Promise<{ value: unknown; after?: () => void }> {
    if (caller.kind === 'host' || caller.role !== 'owner')
      throw new Error('Only a device with full access can manage this host’s devices.')
    this.sweep()
    const by = this.nameOf(caller)
    if (method === 'network.status') return { value: this.status(caller) }
    if (method === 'network.renameDevice') {
      const target = this.target(id.parse(args[0]))
      const renamed = this.host.devices.rename(target.id, hostNameInput.parse(args[1] ?? null))
      if (renamed.name !== target.name)
        this.host.changes.record({
          action: 'renamed',
          byId: caller.id,
          by,
          deviceId: target.id,
          device: target.name,
          name: renamed.name,
        })
      return { value: this.status(caller) }
    }
    if (method === 'network.revoke') {
      const target = this.target(id.parse(args[0]))
      this.host.devices.revoke(target.id)
      this.host.changes.record({ action: 'removed', byId: caller.id, by, deviceId: target.id, device: target.name })
      // A device removing itself hears the answer first; its own connection closes right after.
      if (target.id === caller.id) return { value: this.status(caller), after: () => this.host.removed([target.id]) }
      this.host.removed([target.id])
      return { value: this.status(caller) }
    }
    if (method === 'network.revokeOthers') {
      const others = othersOf(this.host.devices.list(), caller.id)
      for (const device of others) this.host.devices.revoke(device.id)
      if (others.length) {
        this.host.changes.record({ action: 'removedOthers', byId: caller.id, by, count: others.length })
        this.host.removed(others.map((device) => device.id))
      }
      return { value: this.status(caller) }
    }
    if (method === 'network.pair') {
      const access = role.nullish().parse(args[0]) ?? 'owner'
      const owner = z.string().min(1).max(60).nullish().parse(args[1])
      // Scoped to the device, so its next code replaces only its own and never one open on the host's screen.
      const offer = await this.host.pair(access, `${caller.id}:${owner ?? 'device'}`)
      this.offers.set(offer.offerId, { byId: caller.id })
      while (this.offers.size > MAX_TRACKED_OFFERS) this.offers.delete(this.offers.keys().next().value!)
      return { value: offer }
    }
    if (method === 'network.offer') {
      const offerId = id.parse(args[0])
      if (this.offers.get(offerId)?.byId !== caller.id) return { value: { state: 'unknown' } }
      const status = this.host.devices.offerStatus(offerId)
      this.settle(offerId, status)
      return { value: status }
    }
    if (method === 'network.cancelOffer') {
      const offerId = id.parse(args[0])
      if (this.offers.get(offerId)?.byId !== caller.id) return { value: false }
      return { value: this.host.cancelOffer(offerId) }
    }
    if (method === 'network.approveRequest') {
      const requestId = id.parse(args[0])
      const device = this.host.approve(requestId, role.parse(args[1]))
      this.host.changes.record({
        action: 'connected',
        byId: caller.id,
        by,
        deviceId: device.id,
        device: device.name,
        role: device.role,
      })
      return { value: this.status(caller) }
    }
    if (method === 'network.denyRequest') {
      const requestId = id.parse(args[0])
      const request = this.host.requests().find((entry) => entry.id === requestId)
      this.host.deny(requestId)
      if (request)
        this.host.changes.record({ action: 'declined', byId: caller.id, by, device: request.name || 'A device' })
      return { value: this.status(caller) }
    }
    throw new Error('Network access is managed from the host running Ramu')
  }

  /** Announces a device that paired with a code another device made, once, and forgets codes that are done. */
  sweep(): void {
    for (const [offerId, made] of [...this.offers]) {
      const status = this.host.devices.offerStatus(offerId)
      if (made.announced && status.state === 'unknown') this.offers.delete(offerId)
      else this.settle(offerId, status)
    }
  }

  private settle(offerId: string, status: OfferStatus) {
    const made = this.offers.get(offerId)
    if (!made || status.state === 'pending' || made.announced) return
    // Its maker keeps following a used code until the store forgets it; a code nobody used is done.
    if (status.state !== 'redeemed' || !status.device) {
      this.offers.delete(offerId)
      return
    }
    made.announced = true
    const maker = this.host.devices.list().find((device) => device.id === made.byId)
    this.host.changes.record({
      action: 'connected',
      byId: made.byId,
      by: maker?.name ?? 'A removed device',
      deviceId: status.device.id,
      device: status.device.name,
      role: status.device.role,
    })
  }

  private status(caller: DeviceInfo): NetworkStatus {
    return { ...this.host.status(), self: caller.id }
  }

  private nameOf(caller: DeviceInfo): string {
    return this.host.devices.list().find((device) => device.id === caller.id)?.name ?? caller.name
  }

  /** A phone or computer paired here, by its exact id: not "all", a prefix, a linked host or this computer. */
  private target(deviceId: string): DeviceInfo {
    const device = this.host.devices.list().find((entry) => entry.id === deviceId)
    if (!device) throw new Error('That device is no longer paired.')
    if (device.kind === 'host') throw new Error('Linked hosts are managed in Ramu on this host.')
    return device
  }
}
