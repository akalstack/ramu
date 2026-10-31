// What a paired full-access device may do beyond threads and files. Each permission is granted per device on the host:
// permanently, for a while, or once (until that device's last connection closes). The host enforces them; clients only
// read them to offer a request instead of a dead end.

export const DEVICE_PERMISSIONS = ['computer', 'browser', 'terminal', 'settings'] as const
export type DevicePermission = (typeof DEVICE_PERMISSIONS)[number]

export const isDevicePermission = (value: unknown): value is DevicePermission =>
  typeof value === 'string' && (DEVICE_PERMISSIONS as readonly string[]).includes(value)

export const PERMISSION_LABEL: Record<DevicePermission, string> = {
  computer: 'Computer use',
  browser: 'Browser',
  terminal: 'Terminals',
  settings: 'Change settings',
}

export const PERMISSION_HELP: Record<DevicePermission, string> = {
  computer: 'See and control this computer’s screen or apps.',
  browser: 'Use the browser on this host, with its signed-in sites.',
  terminal: 'Open and type into terminals on this host.',
  settings: 'Change this host’s settings, providers and connections.',
}

/** `until` is when it ends (null: until revoked); `session` ends it when the device's last connection closes. */
export interface PermissionGrant {
  until: number | null
  session?: true
}

export type PermissionDuration = 'once' | 'hour' | 'day' | 'always'
export const PERMISSION_DURATIONS: readonly PermissionDuration[] = ['once', 'hour', 'day', 'always']
export const DURATION_LABEL: Record<PermissionDuration, string> = {
  once: 'This time',
  hour: 'For 1 hour',
  day: 'For 1 day',
  always: 'Always',
}

export function grantFor(duration: PermissionDuration, now: number): PermissionGrant {
  if (duration === 'once') return { until: null, session: true }
  if (duration === 'hour') return { until: now + 60 * 60_000 }
  if (duration === 'day') return { until: now + 24 * 60 * 60_000 }
  return { until: null }
}

export const grantActive = (grant: PermissionGrant | undefined, now: number): boolean =>
  !!grant && (grant.until === null || grant.until > now)

/**
 * Whether a device should be offered a control that needs `permission`. An unknown view (an older host, or not read
 * yet) offers it, so the host's own refusal still explains; a known missing grant hides it behind a request instead.
 */
export function mayUse(view: DevicePermissionsView | null | undefined, permission: DevicePermission, now: number) {
  return !view || grantActive(view.permissions[permission] ?? undefined, now)
}

/** What this device holds on a host, as the host reports it to the device. */
export interface DevicePermissionsView {
  permissions: Record<DevicePermission, PermissionGrant | null>
  /** Asked and not answered yet. */
  pending: DevicePermission[]
  /** The host said never: asking again is refused until the host allows it itself. Absent on older hosts. */
  blocked?: DevicePermission[]
}

const SETTINGS_DOMAINS = new Set([
  'settings',
  'mcp',
  'providers',
  'rules',
  'codex',
  'updates',
  'background',
  'learning',
])
const READ = /\.(status|get|list|snapshot|catalog)$/

/** The permission a call needs from a paired device, or null. Reading status and settings stays open. */
export function permissionFor(method: string): DevicePermission | null {
  const domain = method.split('.')[0]!
  if (domain === 'computer') return method === 'computer.status' || method === 'computer.session' ? null : 'computer'
  if (domain === 'hostBrowser') return method === 'hostBrowser.status' ? null : 'browser'
  if (domain === 'term') return method === 'term.list' ? null : 'terminal'
  if (SETTINGS_DOMAINS.has(domain)) return READ.test(method) ? null : 'settings'
  return null
}

const REFUSAL = /^This device needs the (computer|browser|terminal|settings) permission/

export const permissionRefusal = (permission: DevicePermission) =>
  `This device needs the ${permission} permission on this host (${PERMISSION_LABEL[permission]}). Request it, then allow it on the host.`

/** The permission a refusal names, so the device can offer to request it. */
export const refusedPermission = (message: string): DevicePermission | null =>
  (REFUSAL.exec(message)?.[1] as DevicePermission | undefined) ?? null
