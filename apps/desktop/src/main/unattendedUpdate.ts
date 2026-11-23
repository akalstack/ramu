/** How long nobody may have used this computer before a downloaded update installs on its own. */
export const UNATTENDED_IDLE_SECONDS = 5 * 60

/**
 * Whether a downloaded update may install and restart the app without asking: Auto-update is on, the update is ready,
 * nobody has used this computer for a while, and the service owns nothing a restart could end (see `serviceIsIdle`).
 * A reading that fails counts as a no, so an unclear moment waits for the next check.
 */
export async function mayInstallUnattended(read: {
  ready: boolean
  autoUpdate: () => Promise<boolean>
  idleSeconds: () => number
  serviceIdle: () => Promise<boolean>
}): Promise<boolean> {
  if (!read.ready || read.idleSeconds() < UNATTENDED_IDLE_SECONDS) return false
  try {
    if (!(await read.autoUpdate())) return false
  } catch {
    return false
  }
  return read.serviceIdle()
}
