import type { RamuMethods } from '@ramu/shared/api'

type Status = ReturnType<RamuMethods['computer.status']>

export function runtimeHelp(status: Status | null): string {
  if (!status) return 'Checking…'
  if (!status.runtime.available)
    return status.runtime.detail ?? 'Computer use is not available on this host. It currently supports macOS.'
  return `Ready on ${status.runtime.computer.name}. Each thread still needs your approval before the agent can see or control the screen.`
}

/** What Keep awake is doing for computer use right now; an agent stops when the Mac sleeps. */
export function keepAwakeHelp(status: Status | null): string {
  if (!status) return 'Checking…'
  return status.keepAwake
    ? 'On. This computer will not sleep while an agent works on it. The screen may still turn off.'
    : 'Off. This computer may sleep when idle and stop the agent. Turn on Keep awake in Settings → System.'
}

/** App control's state, with the pinned release when the host reports it. */
export function appControlHelp(status: Status | null): string {
  const apps = status?.apps
  if (!apps) return 'App control is not available on this host.'
  if (status.appUpdate?.updateAvailable)
    return `Open Computer Use ${status.appUpdate.installedVersion} is installed. Update to the tested version ${status.appUpdate.supportedVersion}.`
  if (!apps.available) return apps.detail ?? 'App control is not available on this host.'
  const version = status.appVersion ? ` Open Computer Use ${status.appVersion}.` : ''
  return `Ready.${version} Choose an app in a thread; it works in the background without moving your cursor.`
}
