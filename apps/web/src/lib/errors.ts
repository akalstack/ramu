/** The message of a failed call, without Electron's "Error invoking remote method" wrapper or an "Error: " prefix. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^Error: /, '')
}

/**
 * Whether a call failed because the host could not be reached (lost, timed out, never sent), rather than because the
 * host answered with a refusal. Views show such a host as offline and read again when it reconnects.
 */
export function isOfflineError(e: unknown): boolean {
  const reason = e as { message?: unknown; ambiguous?: unknown; notSent?: unknown } | null
  const message = typeof reason?.message === 'string' ? reason.message : typeof e === 'string' ? e : ''
  return (
    reason?.ambiguous === true ||
    reason?.notSent === true ||
    /did not answer in time|socket is not connected|connection (was )?(lost|closed)|ECONNRESET|ECONNREFUSED|not reachable|timed out/i.test(
      message,
    )
  )
}
