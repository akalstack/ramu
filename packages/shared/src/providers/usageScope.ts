import type { UsageReading } from '../types'

/**
 * Antigravity's quota groups. Gemini 4 Argon has its own weekly allowance, separate from the other Gemini models;
 * Claude and GPT draw on one shared allowance, so it is one reading, not one per family.
 */
export const ANTIGRAVITY_SCOPES = { gemini: 'Gemini', argon: 'Gemini 4 Argon', partner: 'Claude & GPT' } as const

/** Which Antigravity group a model, quota bucket or group name belongs to; undefined for anything else. */
export function antigravityScopeOf(name: string): string | undefined {
  const value = name.toLowerCase()
  if (value.includes('argon')) return ANTIGRAVITY_SCOPES.argon
  if (value.startsWith('3p-') || value.includes('claude') || value.includes('gpt')) return ANTIGRAVITY_SCOPES.partner
  if (value.startsWith('gemini')) return ANTIGRAVITY_SCOPES.gemini
  return undefined
}

/** Known provider families share windows; unknown scopes require an exact model identity. */
export function usageAppliesTo(reading: Pick<UsageReading, 'provider' | 'scope'>, model = ''): boolean {
  if (!reading.scope) return true
  const scope = reading.scope.toLowerCase()
  const id = model.toLowerCase()
  if (id === scope) return true
  if (reading.provider === 'claude-code' && ['opus', 'sonnet', 'haiku'].includes(scope))
    return new RegExp(`^(?:claude-(?:[0-9]+-)*)?${scope}(?:[-.:/]|\\[|$)`).test(id)
  if (reading.provider === 'antigravity') {
    // Hosts before the shared reading reported Claude and GPT as two scopes.
    if (scope === 'claude' || scope === 'gpt') return id.startsWith(`${scope}-`)
    if (Object.values(ANTIGRAVITY_SCOPES).some((known) => known.toLowerCase() === scope))
      return antigravityScopeOf(id)?.toLowerCase() === scope
  }
  return false
}
