/**
 * Whether the system's service manager started this process and starts it again after it exits with a failure:
 * launchd names a LaunchAgent's process after its label (Ramu's desktop and `ramu up` agents both start `app.ramu.`),
 * and systemd gives every unit's process an invocation id.
 */
export function managedByServiceManager(env: NodeJS.ProcessEnv): boolean {
  return /^app\.ramu\./.test(env.XPC_SERVICE_NAME ?? '') || Boolean(env.INVOCATION_ID)
}

/** The exit code a restart asked for from another device uses, so launchd's KeepAlive and systemd's on-failure restart. */
export const RESTART_EXIT_CODE = 75
