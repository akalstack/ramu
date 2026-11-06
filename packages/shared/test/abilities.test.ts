import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ABILITY_PREFERENCES,
  abilityListing,
  abilityRoutes,
  type AbilityCheck,
} from '../src/providers/abilities'

const check = (
  provider: AbilityCheck['provider'],
  ability: AbilityCheck['ability'],
  ok = true,
  accountId = 'default',
) =>
  ({ provider, ability, ok, accountId, model: `${provider}-model`, version: '1', checkedAt: '' }) satisfies AbilityCheck
const chosen = () => 'default'

describe('ability routing', () => {
  const checks = [check('codex', 'web_search'), check('claude-code', 'web_search'), check('codex', 'image_generation')]

  it('tries every provider whose check passed, in the fallback order', () => {
    const routes = abilityRoutes('web_search', DEFAULT_ABILITY_PREFERENCES, checks, ['claude-code', 'codex'], chosen)
    expect(routes?.map((route) => route.provider)).toEqual(['claude-code', 'codex'])
  })

  it('uses only the login each provider has chosen, and skips failed checks and excluded providers', () => {
    const others = [check('codex', 'web_search', true, 'work'), check('claude-code', 'web_search', false)]
    expect(abilityRoutes('web_search', DEFAULT_ABILITY_PREFERENCES, others, [], chosen)).toEqual([])
    expect(abilityRoutes('web_search', DEFAULT_ABILITY_PREFERENCES, checks, [], chosen, new Set(['codex']))).toEqual([
      { provider: 'claude-code', model: 'claude-code-model', accountId: 'default' },
    ])
  })

  it('keeps a fixed choice to its provider and model, and Off to nothing', () => {
    const fixed = {
      choices: { web_search: { provider: 'codex' as const, model: 'big' } },
      askBeforeOtherProvider: false,
    }
    expect(abilityRoutes('web_search', fixed, checks, ['claude-code'], chosen)).toEqual([
      { provider: 'codex', model: 'big', accountId: 'default' },
    ])
    const off = { choices: { web_search: 'off' as const }, askBeforeOtherProvider: false }
    expect(abilityRoutes('web_search', off, checks, [], chosen)).toBeNull()
  })

  it('lists what is available, missing and off, with the tool for each', () => {
    const off = { choices: { image_generation: 'off' as const }, askBeforeOtherProvider: false }
    const listing = abilityListing(off, checks, ['codex'], chosen)
    expect(listing.available).toEqual([{ ability: 'web_search', providers: expect.any(Array), tool: 'web_search' }])
    expect(listing.off).toEqual(['image_generation'])
    expect(listing.unavailable).toContain('video_generation')
  })
})
