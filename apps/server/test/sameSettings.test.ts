import { expect, it } from 'vitest'
import { sameSettings } from '../src/agent'

it('treats reordered keys and omitted defaults as the same settings, and a real change as a change', () => {
  const stored = {
    provider: 'claude-code' as const,
    model: 'opus',
    effort: 'medium' as const,
    access: 'auto' as const,
    autoFallback: true,
  }
  const parsed = {
    provider: 'claude-code' as const,
    accountId: 'default',
    model: 'opus',
    effort: 'medium' as const,
    serviceTier: 'standard' as const,
    access: 'auto' as const,
    autoFallback: true,
  }
  expect(sameSettings(stored, parsed)).toBe(true)
  expect(sameSettings(stored, { ...parsed, model: 'sonnet' })).toBe(false)
  expect(sameSettings(stored, { ...parsed, effort: 'high' })).toBe(false)
})
