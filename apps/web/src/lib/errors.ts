/** The message of a failed call, without Electron's "Error invoking remote method" wrapper or an "Error: " prefix. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^Error: /, '')
}

/** Whether a call failed because the host predates that method, so the caller can fall back instead of failing whole. */
export const isUnknownMethod = (error: unknown): boolean => /^Unknown method\b/.test(errorText(error))

/** Runs a call to a host that may predate it: an unknown method gives the fallback, any other failure still throws. */
export async function orWhenUnknown<T, F>(work: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await work()
  } catch (error) {
    if (isUnknownMethod(error)) return fallback
    throw error
  }
}
