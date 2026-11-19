import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ABILITY_PREFERENCES,
  abilityListing,
  abilityRoutes,
  isMcpChoice,
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

  it('sends an ability mapped to a Shared MCP tool to no provider', () => {
    const mapped = { choices: { web_search: { connectionId: 'c1', tool: 'search' } }, askBeforeOtherProvider: false }
    expect(isMcpChoice(mapped.choices.web_search)).toBe(true)
    expect(abilityRoutes('web_search', mapped, checks, ['codex'], chosen)).toEqual([])
  })

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

  it('with Auto, picks the cheapest provider whose sample score is within the margin of the best, and says so', () => {
    const images = [
      { ...check('codex', 'image_generation'), apiKey: true, typicalCostUsd: 0.04, score: 0.9 },
      { ...check('claude-code', 'image_generation'), apiKey: true, typicalCostUsd: 0.01, score: 0.8 },
      { ...check('opencode', 'image_generation'), score: 0.4 },
    ]
    const routes = abilityRoutes('image_generation', DEFAULT_ABILITY_PREFERENCES, images, ['codex', 'opencode'], chosen)
    // OpenCode's subscription costs nothing extra but scored too low, so it is tried last.
    expect(routes?.map((route) => route.provider)).toEqual(['claude-code', 'codex', 'opencode'])
    expect(routes?.[0]?.cheapest).toBe(true)
    expect(routes?.slice(1).some((route) => route.cheapest)).toBe(false)
  })

  it('puts a subscription with room before an API key, and an API key without a reported cost last', () => {
    const searches = [
      { ...check('codex', 'web_search'), apiKey: true },
      { ...check('claude-code', 'web_search'), apiKey: true, typicalCostUsd: 0.02 },
      check('opencode', 'web_search'),
    ]
    const routes = abilityRoutes('web_search', DEFAULT_ABILITY_PREFERENCES, searches, ['codex', 'claude-code'], chosen)
    expect(routes?.map((route) => route.provider)).toEqual(['opencode', 'claude-code', 'codex'])
  })

  it('keeps the fallback order and claims nothing when every provider costs the same', () => {
    const routes = abilityRoutes('web_search', DEFAULT_ABILITY_PREFERENCES, checks, ['codex', 'claude-code'], chosen)
    expect(routes?.map((route) => route.provider)).toEqual(['codex', 'claude-code'])
    expect(routes?.[0]?.cheapest).toBeUndefined()
  })

  it('lists what is available, missing and off, with the tool for each', () => {
    const off = { choices: { image_generation: 'off' as const }, askBeforeOtherProvider: false }
    const listing = abilityListing(off, checks, ['codex'], chosen)
    expect(listing.available).toEqual([{ ability: 'web_search', providers: expect.any(Array), tool: 'web_search' }])
    expect(listing.off).toEqual(['image_generation'])
    expect(listing.unavailable).toContain('video_generation')
  })
})
