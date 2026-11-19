// How a device or host is shown from what it reports it runs on: the brand mark beside its shape, and one line naming it.
import type { DeviceOs } from './types'

/** Brand marks the apps ship; anything else shows only the device's shape. */
export type OsMark =
  | 'apple'
  | 'android'
  | 'ubuntu'
  | 'debian'
  | 'fedora'
  | 'arch'
  | 'mint'
  | 'redhat'
  | 'raspberrypi'
  | 'linux'
  | 'windows'

const DISTRO_MARK: Record<string, OsMark> = {
  ubuntu: 'ubuntu',
  pop: 'ubuntu',
  debian: 'debian',
  fedora: 'fedora',
  arch: 'arch',
  manjaro: 'arch',
  endeavouros: 'arch',
  linuxmint: 'mint',
  rhel: 'redhat',
  centos: 'redhat',
  rocky: 'redhat',
  almalinux: 'redhat',
  raspbian: 'raspberrypi',
}

export function osMark(os: DeviceOs | undefined): OsMark | null {
  switch (os?.os) {
    case 'ios':
    case 'ipados':
    case 'macos':
      return 'apple'
    case 'android':
      return 'android'
    case 'windows':
      return 'windows'
    case 'linux':
      return DISTRO_MARK[os.distro ?? ''] ?? 'linux'
    default:
      return null
  }
}

const OS_NAME: Record<DeviceOs['os'], string> = {
  ios: 'iOS',
  ipados: 'iPadOS',
  android: 'Android',
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
  unknown: '',
}

/** One line: the hardware when known, then the OS and version, such as `iPhone 17 Pro · iOS 26.1` or `Ubuntu 24.04 LTS`. */
export function osLine(os: DeviceOs | undefined): string | null {
  if (!os || os.os === 'unknown') return os?.model ?? null
  const system =
    os.os === 'linux' && os.distroName ? os.distroName : [OS_NAME[os.os], os.version].filter(Boolean).join(' ')
  return [os.model, system].filter(Boolean).join(' · ') || null
}

/** The shape to draw for a device that has not described itself yet, from its name; a computer when nothing fits. */
export function guessForm(name: string): DeviceOs['form'] {
  if (/\b(ipad|tablet|tab)\b/i.test(name)) return 'tablet'
  if (/\b(iphone|android|pixel|galaxy|phone)\b/i.test(name)) return 'phone'
  return 'computer'
}
