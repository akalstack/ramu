import { expect, it } from 'vitest'
import { cursorKeyState } from '../src/providers/adapters/cursor'
import { cursorUsageLimit } from '../src/providers/cursor'

const refuse = (fields: Record<string, unknown>) => async () => {
  throw Object.assign(new Error('refused'), fields)
}

it('tells a paid, free, expired and unknown Cursor login apart', async () => {
  expect(await cursorKeyState(async () => ({ userEmail: 'paid@example.com' }))).toBe('ok')
  expect(await cursorKeyState(refuse({ code: 'plan_required', status: 403 }))).toBe('free')
  expect(await cursorKeyState(refuse({ name: 'AuthenticationError' }))).toBe('rejected')
  expect(await cursorKeyState(refuse({ status: 401 }))).toBe('rejected')
  // Another refusal or a network failure says nothing about the login, so it is left as it is.
  expect(await cursorKeyState(refuse({ code: 'feature_unavailable', status: 403 }))).toBe('unknown')
  expect(await cursorKeyState(refuse({}))).toBe('unknown')
})

it('recognizes a Cursor usage limit by its type, status or code rather than its words', () => {
  expect(cursorUsageLimit({ name: 'RateLimitError' })).toBe(true)
  expect(cursorUsageLimit({ status: 429 })).toBe(true)
  for (const code of ['PRO_USER_USAGE_LIMIT', 'RATE_LIMITED', 'resource_exhausted', 'team_rate_limit_exceeded'])
    expect(cursorUsageLimit({ code })).toBe(true)
  expect(cursorUsageLimit({ code: 'plan_required', status: 403 })).toBe(false)
  expect(cursorUsageLimit(undefined)).toBe(false)
})
