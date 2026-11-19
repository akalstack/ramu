// Test devices: iOS Simulators and Android emulators on the host, leased per thread from Simlock, for agents and
// people to check an app on.

export type TestPlatform = 'ios' | 'android'

export interface PlatformReadiness {
  ready: boolean
  /** Why this host cannot run the platform at all (iOS off a Mac), said once instead of as a failed check. */
  unsupported?: string
  /** Each missing item and its fix, in the order to do them; `item` is Simlock's id, `name` the copy key shown. */
  missing: { item: string; name: string; fix: string }[]
}

const ITEM_NAMES: Record<string, string> = {
  simlock: 'Simlock',
  xcode: 'Xcode',
  'xcode-license': 'Xcode license',
  'xcode-first-launch': 'Xcode first launch',
  'ios-runtime': 'iOS Simulator runtime',
  'android-sdk': 'Android SDK',
  'android-emulator': 'Android Emulator package',
  'android-platform-tools': 'Android platform tools',
  'android-cmdline-tools': 'Android command-line tools',
  'android-jdk': 'Java for the Android tools',
  'android-system-image': 'Android system image',
}

/** A missing item's name as the checklist shows it; one Ramu does not know yet keeps Simlock's own id. */
export const testDeviceItemName = (item: string) => ITEM_NAMES[item] ?? item

/** What a checklist row's button does: open a page to get the tool, or copy a command that needs an administrator. */
export type TestDeviceFix =
  { kind: 'link'; label: string; url: string } | { kind: 'command'; label: string; command: string }

const GET_XCODE: TestDeviceFix = {
  kind: 'link',
  label: 'Get Xcode',
  url: 'macappstore://apps.apple.com/app/id497799835',
}
const GET_ANDROID_STUDIO: TestDeviceFix = {
  kind: 'link',
  label: 'Get Android Studio',
  url: 'https://developer.android.com/studio',
}

/**
 * The button for a missing item `simlock doctor` names, where one helps: a page to install from, or the command for
 * a step that needs an administrator, which Ramu never runs itself.
 */
export function testDeviceFix(item: string): TestDeviceFix | null {
  switch (item) {
    case 'xcode':
      return GET_XCODE
    case 'xcode-license':
      return { kind: 'command', label: 'Copy command', command: 'sudo xcodebuild -license accept' }
    case 'xcode-first-launch':
      return { kind: 'command', label: 'Copy command', command: 'sudo xcodebuild -runFirstLaunch' }
    case 'ios-runtime':
      return { kind: 'command', label: 'Copy command', command: 'xcodebuild -downloadPlatform iOS' }
    case 'android-sdk':
    case 'android-emulator':
    case 'android-platform-tools':
    case 'android-cmdline-tools':
    case 'android-jdk':
    case 'android-system-image':
      return GET_ANDROID_STUDIO
    default:
      return null
  }
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

/** Where one thread's device stands, for its card in the thread: in line, held, or given back. */
export type TestDevicePlace =
  { state: 'waiting'; position: number | null } | { state: 'held'; name: string } | { state: 'none' }

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
  /** How many devices may run at once; null leaves it to the host's memory. */
  maxRunning: number | null
  /** iOS Simulators boot slim: quicker and lighter. */
  slim: boolean
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
  const missing = platforms.filter((entry) => !entry.unsupported).flatMap((entry) => entry.missing.map((m) => m.name))
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
