import { randomUUID } from 'node:crypto'
import type { DevicePermission } from '@ramu/shared/devicePermissions'
import type { DeviceInfo } from './devices'

/** How long a request waits for the person at the host. */
const REQUEST_MS = 10 * 60_000

export interface PermissionRequestView {
  id: string
  deviceId: string
  deviceName: string
  permission: DevicePermission
  at: number
}

/** Permissions paired devices asked for, waiting for a person at the host. One per device and permission. */
export class PermissionRequests {
  private readonly requests = new Map<string, PermissionRequestView>()
  constructor(
    private readonly now: () => number = Date.now,
    /** Told the waiting requests whenever one is added or answered, so the person at the host sees it at once. */
    private readonly changed: (requests: PermissionRequestView[]) => void = () => {},
  ) {}

  private sweep() {
    for (const [id, request] of this.requests) if (this.now() - request.at > REQUEST_MS) this.requests.delete(id)
  }

  ask(device: DeviceInfo, permission: DevicePermission): void {
    this.sweep()
    this.clear(device.id, permission)
    const id = randomUUID()
    this.requests.set(id, { id, deviceId: device.id, deviceName: device.name, permission, at: this.now() })
    this.changed(this.list())
  }

  list(): PermissionRequestView[] {
    this.sweep()
    return [...this.requests.values()]
  }

  pendingFor(deviceId: string): DevicePermission[] {
    return this.list()
      .filter((request) => request.deviceId === deviceId)
      .map((request) => request.permission)
  }

  /** Removes and returns one request, so it is answered once. */
  take(id: string): PermissionRequestView | undefined {
    this.sweep()
    const request = this.requests.get(id)
    if (this.requests.delete(id)) this.changed(this.list())
    return request
  }

  clear(deviceId: string, permission: DevicePermission): void {
    for (const [id, request] of this.requests)
      if (request.deviceId === deviceId && request.permission === permission) this.requests.delete(id)
  }
}
