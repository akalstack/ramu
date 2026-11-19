import { describe, expect, it } from 'vitest'
import { screenshotDelivery } from '../src/computer/tools'

describe('screenshotDelivery', () => {
  it('reports Claude Code as showing screenshots', () => {
    expect(screenshotDelivery('claude-code')).toEqual({ screenshots: 'shown' })
  })
  it.each(['codex', 'opencode', 'cursor', 'antigravity'] as const)(
    'marks %s unverified with a fallback',
    (provider) => {
      const delivery = screenshotDelivery(provider)
      expect(delivery.screenshots).toBe('unverified')
      expect(delivery.note).toMatch(/accessibility text/)
    },
  )
})
