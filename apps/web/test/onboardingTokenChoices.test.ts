import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import { FEWEST_TOKENS, applyTokenChoices, tokenChoicesOf } from '../src/onboarding/tokenChoices'

const withLearning = (learning: AppPreferences['intelligence']['learning']): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  intelligence: { ...DEFAULT_APP_PREFERENCES.intelligence, learning },
})

describe('onboarding token choices', () => {
  it('round-trips the saved preferences unchanged', () => {
    const preferences = withLearning('auto')
    expect(applyTokenChoices(preferences, tokenChoicesOf(preferences))).toEqual(preferences)
  })

  it('turns every token-spending feature off and keeps tools on demand for the fewest tokens', () => {
    const next = applyTokenChoices(DEFAULT_APP_PREFERENCES, FEWEST_TOKENS)
    expect(next.intelligence).toMatchObject({ toolSearch: true, crossThreadRecall: false, learning: 'off' })
    expect(next.goals.mode).toBe('manual')
    expect(next.recapsEnabled).toBe(false)
    expect(next.goals.maxTurns).toBe(DEFAULT_APP_PREFERENCES.goals.maxTurns)
  })

  it('turns learning back on as ask-first, never as automatic saving', () => {
    const off = withLearning('off')
    expect(applyTokenChoices(off, { ...tokenChoicesOf(off), learning: true }).intelligence.learning).toBe('review')
  })
})
