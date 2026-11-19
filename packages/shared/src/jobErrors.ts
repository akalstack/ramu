// Background jobs keep the error their provider threw. Some providers throw their whole result record as JSON, which
// says what went wrong in one field among dozens; this finds that field and says it in a line a person can act on.

const SIGNED_OUT = /not logged in|please run \/login|invalid api key|authentication/i

/** A stored job error as one readable line: the provider's own message, with a sign-in problem said plainly. */
export function readableJobError(error: string): string {
  const text = error.trim().replace(/^Error:\s*/, '')
  let message = text
  if (text.startsWith('{')) {
    try {
      const record = JSON.parse(text) as Record<string, unknown>
      const found = [record.result, record.error, record.message].find(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      )
      message = found ?? (typeof record.terminal_reason === 'string' ? record.terminal_reason : text)
    } catch {
      // Not a whole record: keep what was stored.
    }
  }
  if (SIGNED_OUT.test(message)) return 'The provider was signed out. Sign in under Settings › Providers, then retry.'
  const line = message.replace(/\s+/g, ' ').trim()
  return line.length > 300 ? `${line.slice(0, 299)}…` : line
}
