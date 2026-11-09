// Test devices: iOS Simulators and Android emulators on the host, for agents and people to check an app on.

export type TestPlatform = 'ios' | 'android'

export interface TestDevice {
  /** A simulator UDID, or `avd:<name>` for an Android virtual device. */
  id: string
  platform: TestPlatform
  /** The device's own name with its system, such as `iPhone 17 · iOS 26`. */
  name: string
  running: boolean
  /** The thread using it, when one is. */
  heldBy?: string | null
}

export interface PlatformReadiness {
  ready: boolean
  /** Why this host cannot run the platform at all (iOS off a Mac), said once instead of as a failed check. */
  unsupported?: string
  /** Each missing item and its fix, in the order to do them. */
  missing: { item: string; fix: string }[]
  /** Ready to boot and watch, but taps need this optional helper. */
  note?: string
  /** The terminal command that installs the helper; the host can also run it with `testDevices.installHelper`. */
  install?: string
}

export interface TestDeviceStatus {
  enabled: boolean
  ios: PlatformReadiness
  android: PlatformReadiness
  devices: TestDevice[]
}

/** One part of the Test devices status line: an English copy key and its values, translated where it is drawn. */
export interface SummaryPart {
  text: string
  values?: Record<string, string | number>
}

/**
 * The Test devices page's status line, such as "Ready on iOS and Android · 1 in use" or "Needs setup: Xcode", and
 * whether anything is left to set up on a platform this host can run.
 */
export function testDeviceSummary(status: TestDeviceStatus): {
  state: 'off' | 'ready' | 'setup'
  parts: SummaryPart[]
} {
  if (!status.enabled) return { state: 'off', parts: [{ text: 'Off' }] }
  const platforms = [status.ios, status.android]
  const ios = status.ios.ready,
    android = status.android.ready
  const missing = platforms.filter((entry) => !entry.unsupported).flatMap((entry) => entry.missing.map((m) => m.item))
  const inUse = status.devices.filter((device) => device.running).length
  const parts: SummaryPart[] = []
  if (ios || android)
    parts.push({ text: ios && android ? 'Ready on iOS and Android' : ios ? 'Ready on iOS' : 'Ready on Android' })
  if (missing.length) parts.push({ text: 'Needs setup: {0}', values: { 0: missing.join(', ') } })
  if (!parts.length) parts.push({ text: 'Not available on this host' })
  if (inUse) parts.push({ text: '{0} in use', values: { 0: inUse } })
  return { state: missing.length ? 'setup' : 'ready', parts }
}

/** At most this many devices run at once on a host; each is a full virtual phone. */
export const TEST_DEVICE_LIMIT = 2
/** A device nobody has used or watched for this long shuts down. */
export const TEST_DEVICE_IDLE_MS = 15 * 60_000

/** Width and height from a PNG header, so a capture needs no image library. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const ANDROID_KEYS: Record<string, number> = {
  Enter: 66,
  Return: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  Home: 3,
  Back: 4,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Space: 62,
}

/** The Android key code for a key name, or null for one the emulator has no key for. */
export const androidKeyCode = (key: string): number | null => ANDROID_KEYS[key] ?? null

/** `adb shell input text` takes one shell word: spaces become `%s` and shell characters are escaped. */
export const androidText = (text: string) => text.replace(/([\\'"`$&|;<>()*?#~!{}[\]])/g, '\\$1').replace(/ /g, '%s')

/** Turns a uiautomator dump into short lines an agent can read: what each element says and where its centre is. */
export function uiTreeText(xml: string, limit = 12_000): string {
  const lines: string[] = []
  for (const match of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...match[1]!.matchAll(/(\w[\w-]*)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]))
    const label = attrs.text || attrs['content-desc'] || ''
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? '')
    if (!label && attrs.clickable !== 'true') continue
    const centre = bounds
      ? ` @${Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)},${Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)}`
      : ''
    const kind = (attrs.class ?? '').split('.').pop() ?? ''
    lines.push(`${kind}${label ? ` "${label}"` : ''}${attrs.clickable === 'true' ? ' (tap)' : ''}${centre}`)
  }
  const text = lines.join('\n')
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text
}
