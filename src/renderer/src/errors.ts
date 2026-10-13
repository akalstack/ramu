/** The message of a failed call, without Electron's "Error invoking remote method" wrapper or an "Error: " prefix. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^Error: /, '')
}
