import type { AgentSettings, UsageReading } from '@ramu/shared/types'
import { classifyLimit, parseResetTime } from './limitClassifier'

// Providers without a usage API (OpenCode, Cursor, Antigravity) only reveal a limit through what they say or fail with.
// The rules live in ./limitClassifier; these wrappers keep the older entry points.

/** An error or rejection that means the provider is out of quota, credits or rate allowance (any confidence). */
export const isLimitMessage = (value: string): boolean => classifyLimit(value, { channel: 'error' }) !== null

/**
 * A reply that is just a limit notice, for runtimes that report the limit as ordinary text and end the turn normally.
 * Deliberately narrow: only short replies in a turn that did nothing else, so an answer about rate limiting is not mistaken for one.
 */
export const isLimitReply = (text: string, toolCalls = 0): boolean =>
  classifyLimit(text, { channel: 'reply', toolCalls }) !== null

/** When the notice says how long to wait or when the limit lifts ("in 2 hours", "resets at 5pm"), the time it lifts. */
export function limitResetsAt(text: string, now = Date.now()): number | undefined {
  return parseResetTime(text, { now })?.at
}

/** The reading recorded when a provider without a usage API says it is limited, so routing avoids it until it lifts. */
export function limitedReading(settings: Pick<AgentSettings, 'provider' | 'accountId'>, text: string): UsageReading {
  const resetsAt = limitResetsAt(text)
  return {
    provider: settings.provider,
    ...(settings.accountId && settings.accountId !== 'default' ? { accountId: settings.accountId } : {}),
    window: 'five_hour',
    usedPercent: 100,
    status: 'limited',
    source: 'notice',
    ...(resetsAt ? { resetsAt } : {}),
    updatedAt: Date.now(),
  }
}
