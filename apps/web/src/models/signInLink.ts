// eslint-disable-next-line no-control-regex -- terminal output carries escape sequences that must be dropped
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/**
 * The first complete web link a sign-in command printed, from its output so far. A link still arriving (no space or
 * line end after it yet) is not taken, so a link split across output chunks is never opened half written.
 */
export function signInLinkIn(output: string): string | null {
  const plain = output.replace(ESCAPES, '')
  return /(https:\/\/[^\s"'<>]+)\s/.exec(plain)?.[1] ?? null
}
