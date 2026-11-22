// What a paired full-access device may do beyond threads and files. Each permission is set per device on the host:
// allowed, ask first or blocked. Answering a device's request can also allow it for an hour or until that device's last
// connection closes. The host enforces them; clients only read them to offer a request instead of a dead end.

export const DEVICE_PERMISSIONS = ['computer', 'browser', 'terminal', 'settings', 'agents'] as const
export type DevicePermission = (typeof DEVICE_PERMISSIONS)[number]

/**
 * What a new device holds until the host saves its own defaults. Agents is left out because it lets another machine's
 * agents cause work here, so it takes a choice.
 */
export const AUTOMATIC_PERMISSIONS: readonly DevicePermission[] = DEVICE_PERMISSIONS.filter(
  (permission) => permission !== 'agents',
)

/**
 * The permissions a device can hold. Agents lets another computer's agents start threads here, and a phone or tablet
 * only connects to hosts: it runs no agents of its own, so the permission does not apply to it.
 */
export function permissionsFor(
  os: { form: 'phone' | 'tablet' | 'computer' | 'server' } | undefined,
): readonly DevicePermission[] {
  return os?.form === 'phone' || os?.form === 'tablet'
    ? DEVICE_PERMISSIONS.filter((permission) => permission !== 'agents')
    : DEVICE_PERMISSIONS
}

export const isDevicePermission = (value: unknown): value is DevicePermission =>
  typeof value === 'string' && (DEVICE_PERMISSIONS as readonly string[]).includes(value)

export const PERMISSION_LABEL: Record<DevicePermission, string> = {
  computer: 'Computer use',
  browser: 'Browser',
  terminal: 'Terminals',
  settings: 'Change settings',
  agents: 'Agents',
}

export const PERMISSION_HELP: Record<DevicePermission, string> = {
  computer: 'See and control this computer’s screen or apps.',
  browser: 'Use the browser on this host, with its signed-in sites.',
  terminal: 'Open and type into terminals on this host.',
  settings: 'Change this host’s settings, providers and connections.',
  agents: 'Let agents on that computer start threads here, up to the most access you allow.',
}

/** `until` is when it ends (null: until revoked); `session` ends it when the device's last connection closes. */
export interface PermissionGrant {
  until: number | null
  session?: true
}

/** How long the host allows a request it is answering. Only a request asks this; Settings sets a lasting state. */
export const PERMISSION_DURATIONS = ['once', 'hour', 'always'] as const
export type PermissionDuration = (typeof PERMISSION_DURATIONS)[number]
/** Every answer to a request: a duration, deny this once, or never (block further requests). */
export const PERMISSION_ANSWERS = [...PERMISSION_DURATIONS, 'deny', 'never'] as const
export type PermissionAnswer = (typeof PERMISSION_ANSWERS)[number]
export const DURATION_LABEL: Record<PermissionDuration, string> = {
  once: 'Allow this time',
  hour: 'Allow for 1 hour',
  always: 'Always allow',
}

export function grantFor(duration: PermissionDuration, now: number): PermissionGrant {
  if (duration === 'once') return { until: null, session: true }
  if (duration === 'hour') return { until: now + 60 * 60_000 }
  return { until: null }
}

/**
 * Where a permission stands for one device, as Settings sets it: allowed until revoked, asked for when needed, or
 * blocked so requests are declined without asking. A request answered for a while shows as `temporary`.
 */
export type PermissionState = 'allowed' | 'temporary' | 'ask' | 'blocked'
/** The states a person sets in Settings; `temporary` only comes from answering a request. */
export const PERMISSION_SETTINGS = ['allowed', 'ask', 'blocked'] as const
export type PermissionSetting = (typeof PERMISSION_SETTINGS)[number]
export const PERMISSION_SETTING_LABEL: Record<PermissionSetting, string> = {
  allowed: 'Allowed',
  ask: 'Ask first',
  blocked: 'Blocked',
}

export function permissionState(
  grant: PermissionGrant | null | undefined,
  blocked: boolean,
  now: number,
): PermissionState {
  if (grantActive(grant ?? undefined, now)) return grant!.session || grant!.until !== null ? 'temporary' : 'allowed'
  return blocked ? 'blocked' : 'ask'
}

export const grantActive = (grant: PermissionGrant | undefined, now: number): boolean =>
  !!grant && (grant.until === null || grant.until > now)

/**
 * Whether a device should be offered a control that needs `permission`. An unknown view (not read
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
  /** The host said never: asking again is refused until the host allows it itself. */
  blocked: DevicePermission[]
}

const SETTINGS_DOMAINS = new Set([
  'settings',
  'mcp',
  'providers',
  'rules',
  'plugins',
  'identities',
  'settingsTransfer',
  'toolSync',
  'account',
  'codex',
  'updates',
  'background',
  'learning',
])
const READ = /\.(status|get|list|snapshot|catalog)$/

/** The permission a call needs from a paired device, or null. Reading status and settings stays open. */
export function permissionFor(method: string): DevicePermission | null {
  if (method === 'device.agentPairing') return 'agents'
  if (method === 'network.useLink') return 'settings'
  const domain = method.split('.')[0]!
  if (domain === 'computer') return method === 'computer.status' || method === 'computer.session' ? null : 'computer'
  if (domain === 'hostBrowser') return method === 'hostBrowser.status' ? null : 'browser'
  if (domain === 'term') return method === 'term.list' ? null : 'terminal'
  if (SETTINGS_DOMAINS.has(domain)) return READ.test(method) ? null : 'settings'
  return null
}

const REFUSAL = /^This device needs the (computer|browser|terminal|settings|agents) permission/

export const permissionRefusal = (permission: DevicePermission) =>
  `This device needs the ${permission} permission on this host (${PERMISSION_LABEL[permission]}). Request it, then allow it on the host.`

/** The permission a refusal names, so the device can offer to request it. */
export const refusedPermission = (message: string): DevicePermission | null =>
  (REFUSAL.exec(message)?.[1] as DevicePermission | undefined) ?? null
