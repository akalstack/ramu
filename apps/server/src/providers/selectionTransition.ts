import type { AgentSettings } from '@ramu/shared/types'

/** Ramu rebuilds process-bound tools and permissions when settings change. */
export type SelectionTransition =
  { type: 'restart-and-resume' } | { type: 'handoff' } | { type: 'reject'; reason: string }

export function sameProviderIdentity(current: AgentSettings, target: AgentSettings): boolean {
  return current.provider === target.provider && (current.accountId ?? 'default') === (target.accountId ?? 'default')
}
