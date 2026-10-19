// Limit classifier tests.
//
// Fixtures live in test/fixtures/limits/<provider>.json. Every entry is labelled `synthetic: true` with an `origin`: they are
// built only from strings already present in this repo's code and tests (or, where noted, from wording the plan describes),
// NOT captured from real providers. Capturing real, redacted messages needs live provider runs and is deferred.
// To contribute a message when a provider changes wording: add an entry with the real text (set `synthetic` to false and
// `origin` to where it was captured, redacted), run this file, and add the matching pattern in providers/limitClassifier.ts.
// A provider-specific fixture (`source: 'provider'`) fails if its pattern is removed, because it would fall to 'generic'.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentProvider } from '@ramu/shared/types'
import { classifyLimit, limitSignal, parseResetTime, type LimitMatch } from '../src/providers/limitClassifier'
import { isLimitMessage, isLimitReply, limitResetsAt, limitedReading } from '../src/providers/usageLimit'
import { isUsageLimit } from '../src/agent/usageLimit'

const NOW = Date.parse('2026-10-18T03:00:00Z') // 10:00 in Jakarta
const HOST = 'Asia/Jakarta'

interface Fixture {
  id: string
  synthetic: boolean
  origin: string
  provider: AgentProvider | null
  channel: 'error' | 'reply'
  toolCalls: number
  text?: string
  value?: unknown
  expect: {
    limited: boolean
    confidence?: 'high' | 'low'
    source?: LimitMatch['source']
    resetsInMs?: number
    resetsAtIso?: string
    assumedZone?: boolean
  }
}

const dir = join(__dirname, 'fixtures', 'limits')
const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .flatMap((file) => (JSON.parse(readFileSync(join(dir, file), 'utf8')) as Fixture[]).map((f) => ({ file, ...f })))

describe('limit fixtures', () => {
  it('covers every provider plus generic and negative cases', () => {
    const files = readdirSync(dir).sort()
    expect(files).toEqual(
      ['antigravity', 'claude-code', 'codex', 'cursor', 'generic', 'negative', 'opencode'].map((n) => `${n}.json`),
    )
  })
  it('labels every entry synthetic with a named origin and a unique id', () => {
    for (const f of fixtures) {
      expect(f.synthetic, f.id).toBe(true)
      expect(f.origin.length, f.id).toBeGreaterThan(10)
    }
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length)
  })
  for (const f of fixtures) {
    it(`${f.file}: ${f.id}`, () => {
      const match = classifyLimit(f.value ?? f.text, {
        ...(f.provider ? { provider: f.provider } : {}),
        channel: f.channel,
        toolCalls: f.toolCalls,
        now: NOW,
        hostZone: HOST,
      })
      expect(match !== null).toBe(f.expect.limited)
      if (!match) return
      if (f.expect.confidence) expect(match.confidence).toBe(f.expect.confidence)
      if (f.expect.source) expect(match.source).toBe(f.expect.source)
      if (f.expect.resetsInMs !== undefined) expect(match.resetsAt).toBe(NOW + f.expect.resetsInMs)
      if (f.expect.resetsAtIso) expect(match.resetsAt).toBe(Date.parse(f.expect.resetsAtIso))
      if (f.expect.assumedZone !== undefined) expect(match.resetAssumedZone).toBe(f.expect.assumedZone)
    })
  }
  it('has provider-specific fixtures for every provider that reach structured or provider sources', () => {
    for (const provider of ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']) {
      const specific = fixtures.filter(
        (f) => f.provider === provider && (f.expect.source === 'provider' || f.expect.source === 'structured'),
      )
      expect(specific.length, provider).toBeGreaterThan(0)
    }
  })
})

describe('classification rules', () => {
  it('maps confidence to the runner signal', () => {
    expect(limitSignal(classifyLimit('insufficient_quota'))).toBe(true)
    expect(limitSignal(classifyLimit('some rate limit trouble'))).toBe('low')
    expect(limitSignal(classifyLimit('File not found'))).toBeUndefined()
  })
  it('applies the short-reply guard to low-confidence replies only', () => {
    const long = `Rate limit reached ${'x'.repeat(600)}`
    expect(classifyLimit(long, { channel: 'reply' })).toBeNull()
    // The same wording as a failure the runtime reported needs no guard.
    expect(classifyLimit(long, { channel: 'error' })).toMatchObject({ confidence: 'low' })
    expect(classifyLimit('Rate limit reached', { channel: 'reply', toolCalls: 2 })).toBeNull()
    expect(classifyLimit('Rate limit reached', { channel: 'reply', toolCalls: 0 })).toMatchObject({ confidence: 'low' })
    // A confident provider phrase in a reply that is not too long does not need the 500-character guard.
    const medium = `You've hit your usage limit. ${'See your plan. '.repeat(40)}`
    expect(medium.length).toBeGreaterThan(500)
    expect(classifyLimit(medium, { provider: 'cursor', channel: 'reply' })).toMatchObject({ confidence: 'high' })
  })
  it('never treats prompt-size, auth or file errors as limits, even next to limit words', () => {
    for (const text of [
      'prompt is too long',
      'maximum context length is 200000 tokens',
      'context window exceeded',
      'Unauthorized',
      'invalid api key',
      'ENOENT: no such file',
    ]) {
      expect(classifyLimit(text), text).toBeNull()
      expect(isUsageLimit(text), text).toBe(false)
      expect(isLimitMessage(text), text).toBe(false)
    }
  })
  it('keeps the older wrappers consistent with the classifier', () => {
    expect(isUsageLimit({ api_error: 'usage_limit_reached' })).toBe(true)
    expect(isUsageLimit({ codexErrorInfo: 'usageLimitExceeded' })).toBe(true)
    expect(isUsageLimit(new Error('Unauthorized'))).toBe(false)
    expect(isUsageLimit('There is a usage limit on this plan')).toBe(true)
    expect(isLimitReply("You've hit your usage limit.", 1)).toBe(false)
    expect(isLimitMessage('Error 429 Too Many Requests')).toBe(true)
  })
  it('records the reset time and a source marker on the reading built from a notice', () => {
    const reading = limitedReading({ provider: 'cursor' }, 'Try again in 2 hours.')
    expect(reading).toMatchObject({ provider: 'cursor', status: 'limited', usedPercent: 100, source: 'notice' })
    expect(reading.resetsAt).toBeGreaterThan(Date.now() + 7_100_000)
    const absolute = limitedReading({ provider: 'cursor' }, "You've hit your usage limit. Resets 2099-01-01T00:00:00Z")
    expect(absolute.resetsAt).toBeUndefined() // beyond the 31-day cap
    const soon = new Date(Date.now() + 3 * 3_600_000)
    const iso = soon.toISOString()
    expect(limitedReading({ provider: 'cursor' }, `Resets at ${iso}`).resetsAt).toBe(Date.parse(iso))
  })
})

describe('parseResetTime', () => {
  const at = (text: string, now = NOW, hostZone = HOST) => parseResetTime(text, { now, hostZone })
  it('reads relative times with the 31-day cap', () => {
    expect(at('try again in 2 hours')?.at).toBe(NOW + 7_200_000)
    expect(at('retry after 30s')).toEqual({ at: NOW + 30_000, assumedZone: false })
    expect(at('in 40 days')).toBeUndefined()
    expect(at('quota exceeded')).toBeUndefined()
    expect(limitResetsAt('Rate limited. Try again in 2 hours.', 0)).toBe(7_200_000)
  })
  it('reads wall-clock times in the host zone and says the zone was assumed', () => {
    // 10:00 in Jakarta: 5pm is later today.
    expect(at('resets at 5pm')).toEqual({ at: Date.parse('2026-10-18T10:00:00Z'), assumedZone: true })
    expect(at('Resets 5pm')?.at).toBe(Date.parse('2026-10-18T10:00:00Z'))
    expect(at('try again at 5:30 PM')?.at).toBe(Date.parse('2026-10-18T10:30:00Z'))
  })
  it('rolls a time that has passed to the next day', () => {
    expect(at('resets at 9am')?.at).toBe(Date.parse('2026-10-19T02:00:00Z'))
  })
  it('uses the zone the notice reports', () => {
    expect(at('at 17:00 UTC')).toEqual({ at: Date.parse('2026-10-18T17:00:00Z'), assumedZone: false })
    expect(at('resets 5pm (America/New_York)')).toEqual({ at: Date.parse('2026-10-18T21:00:00Z'), assumedZone: false })
    expect(at('resets at 5pm Asia/Tokyo')?.at).toBe(Date.parse('2026-10-18T08:00:00Z'))
    expect(at('resets at 17:00 GMT+7')?.at).toBe(Date.parse('2026-10-18T10:00:00Z'))
    expect(at('resets at 17:00 +07:00')?.at).toBe(Date.parse('2026-10-18T10:00:00Z'))
  })
  it('reads ISO timestamps, with or without an offset', () => {
    expect(at('resets 2026-10-19T02:00:00Z')).toEqual({ at: Date.parse('2026-10-19T02:00:00Z'), assumedZone: false })
    expect(at('resets 2026-10-19T09:00:00+07:00')?.at).toBe(Date.parse('2026-10-19T02:00:00Z'))
    expect(at('resets 2026-10-19T09:00:00')).toEqual({ at: Date.parse('2026-10-19T02:00:00Z'), assumedZone: true })
  })
  it('reads dates with a time, rolling a past date to next year', () => {
    expect(at('Resets Oct 20, 3:05 PM')?.at).toBe(Date.parse('2026-10-20T08:05:00Z'))
    expect(at('try again at Oct 20th, 2026 3:05 PM')?.at).toBe(Date.parse('2026-10-20T08:05:00Z'))
    // Jan 2 has passed this year; next year is beyond the 31-day cap, so it is rejected rather than guessed.
    expect(at('resets Jan 2, 3:00 PM')).toBeUndefined()
  })
  it('keeps wall-clock time across a DST change', () => {
    // US clocks go back on 2026-11-01. "5pm New York" the day before is 21:00Z; the day after it is 22:00Z.
    const before = Date.parse('2026-10-31T12:00:00Z')
    expect(parseResetTime('resets 5pm (America/New_York)', { now: before })?.at).toBe(
      Date.parse('2026-10-31T21:00:00Z'),
    )
    const after = Date.parse('2026-11-01T23:00:00Z') // 18:00 EST, 5pm has passed
    expect(parseResetTime('resets 5pm (America/New_York)', { now: after })?.at).toBe(Date.parse('2026-11-02T22:00:00Z'))
  })
  it('rejects the past and nonsense', () => {
    expect(at('resets 2020-01-01T00:00:00Z')).toBeUndefined()
    expect(at('at 25:99')).toBeUndefined()
    expect(at('resets at 13pm')).toBeUndefined()
    expect(at('nothing to see')).toBeUndefined()
    expect(at('2 files at 5 are failing')).toBeUndefined()
  })
})
