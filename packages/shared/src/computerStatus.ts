import type { RamuMethods } from '@ramu/shared/api'

type Status = ReturnType<RamuMethods['computer.status']>

export function runtimeHelp(status: Status | null): string {
  if (!status) return 'Checking…'
  if (!status.runtime.available)
    return status.runtime.detail ?? 'Computer use is not available on this host. It currently supports macOS.'
  return `Ready on ${status.runtime.computer.name}. Each thread still needs your approval before the agent can see or control the screen.`
}

/** App control's state, with the pinned release when the host reports it. */
export function appControlHelp(status: Status | null): string {
  const apps = status?.apps
  if (!apps) return 'App control is not available on this host.'
  if (status.appUpdate?.updateAvailable)
    return `Open Computer Use ${status.appUpdate.installedVersion} is installed. Update to the tested version ${status.appUpdate.supportedVersion}.`
  if (!apps.available) return apps.detail ?? 'App control is not available on this host.'
  const version = status.appVersion ? ` Open Computer Use ${status.appVersion}.` : ''
  if (status.appPermissions === undefined)
    return `Installed.${version} Restart the background service to check permissions.`
  if (!status.appPermissions)
    return `Installed.${version} Permission status could not be checked. Try again to read the current permissions.`
  if (!status.appPermissions.allGranted) {
    const missing = [
      !status.appPermissions.accessibilityTrusted && 'Accessibility',
      !status.appPermissions.screenCaptureGranted && 'Screen Recording',
    ]
      .filter(Boolean)
      .join(' and ')
    return `Allow ${missing} to finish setup.${version}`
  }
  return `Permissions granted.${version} Choose an app from a thread’s Computer menu to let the agent work in it.`
}
