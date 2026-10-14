// Providers without a usage API (OpenCode, Cursor, Antigravity) only reveal a limit through what they say or fail with.

/** An error or rejection that means the provider is out of quota, credits or rate allowance. */
export const isLimitMessage = (value: string): boolean =>
  /usage.?limit|rate.?limit|spend.?limit|quota|\b429\b|resource_exhausted|too many requests|insufficient_quota|out of (?:usage|credits?)|credits? (?:are )?(?:exhausted|depleted)|hit your .*(?:usage|spend|limit)/i.test(value)

/**
 * A reply that is just a limit notice, for runtimes that report the limit as ordinary text and end the turn normally.
 * Deliberately narrow: only short replies in a turn that did nothing else, so an answer about rate limiting is not mistaken for one.
 */
export const isLimitReply = (text: string, toolCalls = 0): boolean =>
  toolCalls === 0 && text.trim().length > 0 && text.trim().length < 500
  && /hit your .*(?:usage|spend|limit)|(?:usage|spend|rate).?limit.{0,40}(?:reached|exceeded|hit)|(?:reached|exceeded|hit).{0,40}(?:usage|spend|rate).?limit|out of (?:usage|credits?)|quota (?:exceeded|exhausted)|exceeded your .{0,20}(?:quota|limit|usage)|resource_exhausted|too many requests/i.test(text)

const UNIT_MS: Record<string, number> = { s: 1000, sec: 1000, second: 1000, m: 60_000, min: 60_000, minute: 60_000, h: 3_600_000, hr: 3_600_000, hour: 3_600_000, d: 86_400_000, day: 86_400_000 }
/** When the notice says how long to wait ("try again in 2 hours", "retry after 30s"), the time the limit lifts. */
export function limitResetsAt(text: string, now = Date.now()): number | undefined {
  const match = /(?:in|after|wait)\s+(\d+(?:\.\d+)?)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day)s?\b/i.exec(text)
  if (!match) return undefined
  const ms = Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]!
  return ms > 0 && ms <= 31 * 86_400_000 ? now + ms : undefined
}
