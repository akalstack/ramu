// Test devices: iOS Simulators and Android emulators on the host, leased per thread from Simlock, for agents and
// people to check an app on.

export type TestPlatform = 'ios' | 'android'

export interface PlatformReadiness {
  ready: boolean
  /** Why this host cannot run the platform at all (iOS off a Mac), said once instead of as a failed check. */
  unsupported?: string
  /** Each missing item and its fix, in the order to do them. */
  missing: { item: string; fix: string }[]
}

/** A device a thread holds now. Simlock made it for that thread and deletes it once the thread lets go. */
export interface TestDeviceLease {
  taskId: string
  platform: TestPlatform
  /** The model with its system, such as `iPhone 17 · iOS 27.0`. */
  name: string
  since: number
}

/** A thread waiting for a device while the host is full; `position` counts from 1, null while one is being made. */
export interface TestDeviceWaiting {
  taskId: string
  platform: TestPlatform
  position: number | null
}

/** A model this host can lease, with the systems it pairs with, newest first. */
export interface TestDeviceModel {
  name: string
  /** phone, tablet, watch and so on, as the platform's tools say. */
  kind: string
  systems: string[]
}

export interface TestDeviceStatus {
  enabled: boolean
  /** Simlock and agent-device are installed in Ramu's tools folder. */
  installed: boolean
  /** The same installation as **Set up test devices**, to paste into a terminal of the person's own. */
  setupCommand: string
  ios: PlatformReadiness
  android: PlatformReadiness
  inUse: TestDeviceLease[]
  waiting: TestDeviceWaiting[]
  /** Models with at least one installed system to run on, per platform; empty before setup. */
  models: Record<TestPlatform, TestDeviceModel[]>
  /** The model a thread gets when it names none: the person's choice, otherwise the platform's own default. */
  defaults: Record<TestPlatform, string | null>
  /** A spare device of the kind last used stays booted, so the next thread starts sooner; it costs memory. */
  keepWarm: boolean
}

/** One part of the Test devices status line: an English copy key and its values, translated where it is drawn. */
export interface SummaryPart {
  text: string
  values?: Record<string, string | number>
}

/**
 * The Test devices page's status line, such as "Ready on iOS and Android · 2 in use · 1 waiting" or "Needs setup:
 * Xcode", and whether anything is left to set up on a platform this host can run.
 */
export function testDeviceSummary(status: TestDeviceStatus): {
  state: 'off' | 'ready' | 'setup'
  parts: SummaryPart[]
} {
  if (!status.enabled) return { state: 'off', parts: [{ text: 'Off' }] }
  if (!status.installed) return { state: 'setup', parts: [{ text: 'Needs setup' }] }
  const platforms = [status.ios, status.android]
  const ios = status.ios.ready,
    android = status.android.ready
  const missing = platforms.filter((entry) => !entry.unsupported).flatMap((entry) => entry.missing.map((m) => m.item))
  const parts: SummaryPart[] = []
  if (ios || android)
    parts.push({ text: ios && android ? 'Ready on iOS and Android' : ios ? 'Ready on iOS' : 'Ready on Android' })
  if (missing.length) parts.push({ text: 'Needs setup: {0}', values: { 0: missing.join(', ') } })
  if (!parts.length) parts.push({ text: 'Not available on this host' })
  if (status.inUse.length) parts.push({ text: '{0} in use', values: { 0: status.inUse.length } })
  if (status.waiting.length) parts.push({ text: '{0} waiting', values: { 0: status.waiting.length } })
  return { state: missing.length ? 'setup' : 'ready', parts }
}

/** Where a waiting thread stands, as an English copy key with its place as the value. */
export function queuePlace(position: number | null): SummaryPart {
  return position === null
    ? { text: 'Getting a device ready' }
    : { text: 'Waiting for a device · number {0} in line', values: { 0: position } }
}

/** Width and height from a PNG header, so a capture needs no image library. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Orientations an iOS Simulator turns to; Android emulators and physical phones are refused by Simlock. */
export const TEST_DEVICE_ORIENTATIONS = [
  'portrait',
  'portrait-upside-down',
  'landscape-left',
  'landscape-right',
] as const
export type TestDeviceOrientation = (typeof TEST_DEVICE_ORIENTATIONS)[number]
