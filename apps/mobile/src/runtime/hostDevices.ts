// Pure rules for a host's Devices screen on the phone: who may manage them from here, and how the list reads. No React
// Native imports, so Node tests cover them.
import { mayUse, type DevicePermissionsView } from '@ramu/shared/devicePermissions'
import type { NetworkDevice, NetworkStatus } from '@ramu/shared/types'

/**
 * What this phone can do with a host's devices: manage them, ask for the Change settings permission first, or nothing
 * (view-only access). The host decides on every call; this only picks what to show.
 */
export function devicesAccess(
  access: 'owner' | 'viewer' | undefined,
  permissions: DevicePermissionsView | null | undefined,
  now: number,
): 'manage' | 'request' | 'viewer' {
  if (access === 'viewer') return 'viewer'
  return mayUse(permissions, 'settings', now) ? 'manage' : 'request'
}

export interface DeviceRow {
  device: NetworkDevice
  /** This phone itself. */
  self: boolean
}

/** The phones and computers paired with the host, this phone first, then the most recently seen. Linked hosts are not. */
export function deviceRows(status: Pick<NetworkStatus, 'devices' | 'self'>): DeviceRow[] {
  return status.devices
    .filter((device) => device.kind !== 'host')
    .map((device) => ({ device, self: device.id === status.self }))
    .sort(
      (a, b) =>
        Number(b.self) - Number(a.self) ||
        (b.device.lastSeenAt ?? 0) - (a.device.lastSeenAt ?? 0) ||
        a.device.name.localeCompare(b.device.name),
    )
}

/** How many devices "Remove others" ends: every listed one but this phone. */
export const othersCount = (rows: DeviceRow[]) => rows.filter((row) => !row.self).length
