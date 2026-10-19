import type { UsageReading } from '../types'

/** Known provider families share windows; unknown scopes require an exact model identity. */
export function usageAppliesTo(reading: Pick<UsageReading, 'provider' | 'scope'>, model = ''): boolean {
  if (!reading.scope) return true
  const scope = reading.scope.toLowerCase()
  const id = model.toLowerCase()
  if (id === scope) return true
  if (reading.provider === 'claude-code' && ['opus', 'sonnet', 'haiku'].includes(scope))
    return new RegExp(`^(?:claude-(?:[0-9]+-)*)?${scope}(?:[-.:/]|\\[|$)`).test(id)
  if (reading.provider === 'antigravity' && ['gemini', 'claude', 'gpt'].includes(scope))
    return id.startsWith(`${scope}-`)
  return false
}
