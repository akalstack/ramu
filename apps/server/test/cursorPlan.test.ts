import { expect, it } from 'vitest'
import { cursorPlanRequired } from '../src/providers/adapters/cursor'

it('tells a free Cursor account apart from a paid one or an unrelated failure', async () => {
  const refuse = (code?: string) => async () => {
    throw Object.assign(new Error('[plan_required] Cloud Agent is not available for free users.'), { code })
  }
  expect(await cursorPlanRequired(refuse('plan_required'))).toBe(true)
  expect(await cursorPlanRequired(async () => ({ userEmail: 'paid@example.com' }))).toBe(false)
  // Another refusal or a network failure is not proof of a free plan, so the login is left as it is.
  expect(await cursorPlanRequired(refuse('feature_unavailable'))).toBe(false)
  expect(await cursorPlanRequired(refuse())).toBe(false)
})
