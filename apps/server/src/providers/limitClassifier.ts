import { DateTime } from 'luxon'
import { systemTimezone } from '@ramu/shared/workspace/timezone'
import type { AgentProvider } from '@ramu/shared/types'

/**
 * The one place that decides whether an error or reply from a provider means "out of quota, credits or rate allowance".
 * Order of trust: structured fields, then provider-specific wording, then a generic fallback that is marked low-confidence.
 * Callers enter the limit wait directly on a high-confidence match and retry once on a low one.
 */
export type LimitConfidence = 'high' | 'low'
export interface LimitMatch {
  confidence: LimitConfidence
  source: 'structured' | 'provider' | 'retry-exhausted' | 'generic'
  /** When the notice says the limit lifts, as epoch ms. */
  resetsAt?: number
  /** The reset time was read as wall-clock time and no zone was reported, so the host's zone was assumed. */
  resetAssumedZone?: boolean
}
export interface LimitContext {
  provider?: AgentProvider
  /** `error`: a failure the runtime reported. `reply`: ordinary assistant text that ended a turn normally. */
  channel?: 'error' | 'reply'
  toolCalls?: number
  now?: number
  hostZone?: string
}

/** Structured field values that name a limit, whatever the provider calls the field (`api_error`, `codexErrorInfo`, `type`, `code`, ...). */
const STRUCTURED_VALUE =
  /^(?:usage_limit_reached|usage_limit_exceeded|usageLimitExceeded|rateLimitExceeded|rate_limit_error|rate_limit_exceeded|insufficient_quota|resource_exhausted)$/i

/** Never a limit, even when the same text mentions tokens, quota or limits: these are ordinary errors. */
const NOT_A_LIMIT =
  /prompt is too long|context.?length|maximum context|context window|too many tokens in|exceeds? the (?:maximum|model'?s?) .{0,30}(?:context|tokens)|unauthori[sz]ed|invalid api key|authentication (?:failed|error|required)|not logged in|file not found|no such file|ENOENT|does not exist/i

/** Wording each provider is known to use. Derived from strings already in this repo's code and tests; see the fixtures. */
const PROVIDER_PATTERNS: Record<AgentProvider, RegExp[]> = {
  'claude-code': [/usage_limit_reached|usage limit reached/i, /hit your (?:usage |spend )?limit/i],
  codex: [/usageLimitExceeded|rateLimitExceeded|usage_limit_reached/i],
  opencode: [
    /insufficient_quota/i,
    /out of (?:usage|credits?)|credits? (?:are )?(?:exhausted|depleted)/i,
    /hit your .{0,40}(?:usage|spend|limit)/i,
    /quota (?:exceeded|exhausted)/i,
  ],
  cursor: [
    /hit your .{0,40}(?:usage|spend|limit)/i,
    /out of (?:usage|credits?)/i,
    /quota (?:exceeded|exhausted)|exceeded your .{0,20}(?:quota|limit|usage)/i,
    /resource_exhausted/i,
  ],
  antigravity: [
    /resource_exhausted/i,
    /quota (?:exceeded|exhausted)|exceeded your .{0,20}(?:quota|limit|usage)/i,
    /hit your .{0,40}(?:usage|spend|limit)/i,
    /out of (?:usage|credits?)/i,
  ],
}

/** A 429 or rate-limit failure that says its own retries ran out: the provider is rate limiting, not a one-off blip. */
const RETRY_EXHAUSTED =
  /(?:\b429\b|rate.?limit|too many requests).{0,100}(?:retr(?:y|ies)|attempts?).{0,40}(?:exhausted|exceeded|failed|max)|(?:exhausted|exceeded|max(?:imum)?|after \d+).{0,40}(?:retr(?:y|ies)|attempts?).{0,100}(?:\b429\b|rate.?limit|too many requests)/i

/** Fallback for a failure the runtime reported: any mention of a limit. Low confidence, since "429" and "quota" have other meanings. */
const GENERIC_ERROR =
  /usage.?limit|rate.?limit|spend.?limit|quota|\b429\b|resource_exhausted|too many requests|insufficient_quota|out of (?:usage|credits?)|credits? (?:are )?(?:exhausted|depleted)|hit your .*(?:usage|spend|limit)/i

/** Fallback for ordinary assistant text: deliberately narrow, so an answer about rate limiting is not taken for a notice. */
const GENERIC_REPLY =
  /hit your .*(?:usage|spend|limit)|(?:usage|spend|rate).?limit.{0,40}(?:reached|exceeded|hit)|(?:reached|exceeded|hit).{0,40}(?:usage|spend|rate).?limit|out of (?:usage|credits?)|quota (?:exceeded|exhausted)|exceeded your .{0,20}(?:quota|limit|usage)|resource_exhausted|too many requests/i

const REPLY_MAX_LOW = 500
/** A reply this long is an answer, not a notice, whatever it says. */
const REPLY_MAX_ANY = 2000

function hasStructuredLimit(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.rate_limit_info && typeof record.rate_limit_info === 'object') {
    if ((record.rate_limit_info as { status?: unknown }).status === 'rejected') return true
  }
  for (const [key, entry] of Object.entries(record)) {
    if (
      typeof entry === 'string' &&
      /^(?:api_error|codexErrorInfo|code|type|error_type|errorType|status|reason|error|result)$/i.test(key)
    ) {
      if (STRUCTURED_VALUE.test(entry)) return true
    } else if (entry && typeof entry === 'object' && hasStructuredLimit(entry, depth + 1)) return true
  }
  return false
}

function asText(value: unknown): { text: string; object?: unknown } {
  if (value instanceof Error) return { text: value.message, object: value }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return { text: value, object: JSON.parse(trimmed) }
      } catch {
        /* plain text that happens to start with a brace */
      }
    }
    return { text: value }
  }
  try {
    return { text: JSON.stringify(value) ?? '', object: value }
  } catch {
    return { text: String(value) }
  }
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  second: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
}
const MAX_AHEAD_MS = 31 * 86_400_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A zone named in the notice: an IANA name, UTC/GMT/Z, or an offset such as +07:00 or UTC+7. Null when none is given. */
function reportedZone(text: string): string | null {
  const iana = /\b([A-Z][A-Za-z]+(?:\/[A-Za-z_+-]+)+)\b/.exec(text)
  if (iana && DateTime.now().setZone(iana[1]!).isValid) return iana[1]!
  const utcOffset = /\b(?:UTC|GMT)\s?([+-])(\d{1,2})(?::?(\d{2}))?\b/i.exec(text)
  if (utcOffset)
    return `UTC${utcOffset[1]}${Number(utcOffset[2])}${utcOffset[3] && utcOffset[3] !== '00' ? `:${utcOffset[3]}` : ''}`
  if (/\b(?:UTC|GMT|Z)\b/.test(text)) return 'UTC'
  const offset = /(?:^|[\s(])([+-])(\d{2}):?(\d{2})\b(?!\d)/.exec(text)
  if (offset) return `UTC${offset[1]}${Number(offset[2])}${offset[3] !== '00' ? `:${offset[3]}` : ''}`
  return null
}

function clock(
  hourText: string,
  minuteText: string | undefined,
  meridiem: string | undefined,
): [number, number] | null {
  let hour = Number(hourText)
  const minute = minuteText ? Number(minuteText) : 0
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    const pm = meridiem.toLowerCase() === 'pm'
    hour = (hour % 12) + (pm ? 12 : 0)
  } else if (hour > 23) return null
  return [hour, minute]
}

/**
 * When a limit notice says the limit lifts: "in 2 hours", "resets at 5pm", "try again at 5:30 PM", "at 17:00 UTC",
 * "Oct 20, 3:05 PM (America/New_York)" or an ISO timestamp. A zone the notice names wins; otherwise wall-clock times are
 * read in the host's zone and `assumedZone` is true. A time that already passed today rolls to tomorrow (or next year for
 * a date). Nothing in the past or more than 31 days ahead is returned.
 */
export function parseResetTime(
  text: string,
  { now = Date.now(), hostZone = systemTimezone() }: { now?: number; hostZone?: string } = {},
): { at: number; assumedZone: boolean } | undefined {
  const within = (at: number, assumedZone: boolean) =>
    at > now && at - now <= MAX_AHEAD_MS ? { at, assumedZone } : undefined
  const relative = /(?:in|after|wait)\s+(\d+(?:\.\d+)?)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day)s?\b/i.exec(text)
  if (relative) {
    const ms = Number(relative[1]) * UNIT_MS[relative[2]!.toLowerCase()]!
    return ms > 0 ? within(now + ms, false) : undefined
  }
  const zoneName = reportedZone(text)
  const zone = zoneName ?? hostZone
  const assumed = zoneName === null
  const iso = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?/.exec(text)
  if (iso) {
    const stamp = iso[1]!.replace(' ', 'T')
    const parsed = iso[2]
      ? DateTime.fromISO(`${stamp}${iso[2].length === 5 ? `${iso[2].slice(0, 3)}:${iso[2].slice(3)}` : iso[2]}`)
      : DateTime.fromISO(stamp, { zone })
    return parsed.isValid ? within(parsed.toMillis(), !iso[2] && assumed) : undefined
  }
  const date = new RegExp(
    `\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?:,?\\s+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?)?`,
    'i',
  ).exec(text)
  if (date && (date[4] || date[3])) {
    const time = date[4] ? clock(date[4], date[5], date[6]) : ([0, 0] as [number, number])
    if (!time) return undefined
    const month = MONTHS.indexOf(date[1]!.toLowerCase()) + 1
    const base = { month, day: Number(date[2]), hour: time[0], minute: time[1] }
    const year = date[3] ? Number(date[3]) : DateTime.fromMillis(now, { zone }).year
    let at = DateTime.fromObject({ year, ...base }, { zone })
    if (!at.isValid) return undefined
    if (!date[3] && at.toMillis() <= now) at = at.plus({ years: 1 })
    return within(at.toMillis(), assumed)
  }
  const wall =
    /(?:\bat|\bresets?(?:\s+at)?|\buntil|\bby|\bafter)\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b|(?:\bat|\bresets?(?:\s+at)?|\buntil|\bby)\s+(\d{1,2})\s*(am|pm)\b/i.exec(
      text,
    )
  if (wall) {
    const time = wall[1] ? clock(wall[1], wall[2], wall[3]) : clock(wall[4]!, undefined, wall[5])
    if (!time) return undefined
    let at = DateTime.fromMillis(now, { zone }).set({ hour: time[0], minute: time[1], second: 0, millisecond: 0 })
    if (at.toMillis() <= now) at = at.plus({ days: 1 }).set({ hour: time[0], minute: time[1] })
    return within(at.toMillis(), assumed)
  }
  return undefined
}

function withReset(
  match: Omit<LimitMatch, 'resetsAt' | 'resetAssumedZone'>,
  text: string,
  ctx: LimitContext,
): LimitMatch {
  const reset = parseResetTime(text, { now: ctx.now, hostZone: ctx.hostZone })
  return reset ? { ...match, resetsAt: reset.at, resetAssumedZone: reset.assumedZone } : match
}

/**
 * Whether a failure or reply means the account hit a usage, rate or spend limit, and how sure that is.
 * Structured fields and provider-specific wording are high confidence; the generic fallback is low.
 * Ordinary assistant text (`channel: 'reply'`) only counts when the turn made no tool calls, and a low-confidence reply
 * match must also be short, so an answer about rate limiting is not mistaken for a notice.
 */
export function classifyLimit(value: unknown, ctx: LimitContext = {}): LimitMatch | null {
  const { text, object } = asText(value)
  const reply = ctx.channel === 'reply'
  if (reply) {
    const trimmed = text.trim()
    if ((ctx.toolCalls ?? 0) !== 0 || !trimmed || trimmed.length >= REPLY_MAX_ANY) return null
  }
  if (!reply && object !== undefined && hasStructuredLimit(object))
    return withReset({ confidence: 'high', source: 'structured' }, text, ctx)
  if (!text || NOT_A_LIMIT.test(text)) return null
  const patterns = ctx.provider ? PROVIDER_PATTERNS[ctx.provider] : Object.values(PROVIDER_PATTERNS).flat()
  if (patterns.some((pattern) => pattern.test(text)))
    return withReset({ confidence: 'high', source: 'provider' }, text, ctx)
  if (!reply && RETRY_EXHAUSTED.test(text))
    return withReset({ confidence: 'high', source: 'retry-exhausted' }, text, ctx)
  if (reply) {
    if (text.trim().length < REPLY_MAX_LOW && GENERIC_REPLY.test(text))
      return withReset({ confidence: 'low', source: 'generic' }, text, ctx)
    return null
  }
  return GENERIC_ERROR.test(text) ? withReset({ confidence: 'low', source: 'generic' }, text, ctx) : null
}

/** What a runner passes as the limit argument of `emit`: `true` when sure, `'low'` when only a generic phrase matched. */
export function limitSignal(match: LimitMatch | null): true | 'low' | undefined {
  return match ? (match.confidence === 'high' ? true : 'low') : undefined
}
