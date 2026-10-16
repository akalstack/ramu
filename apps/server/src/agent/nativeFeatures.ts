// Native-first: a provider's own feature is used unless Ramu's flow needs something it cannot do.
import type { AgentSessionInfo, AppPreferences } from '@ramu/shared/types'
import { providerAdapter } from '../providers/adapters'

/**
 * The model for the provider's own advisor, when it can serve Ramu's advisor setting: the advisor is on, the chat is a
 * main chat, and the chosen step is on the chat's own provider. Null means Ramu's cross-provider advisor is needed.
 */
export function nativeAdvisorModel(prefs: AppPreferences | undefined, s: AgentSessionInfo): string | null {
  const advisor = prefs?.advisor
  if (!advisor?.enabled || !advisor.step || s.parentId) return null
  return providerAdapter(s.provider).native?.advisor && advisor.step.provider === s.provider ? advisor.step.model : null
}

/** Ramu's question tools are needed for async answers; with async questions off, a native blocking tool is enough. */
export function usesRamuQuestions(prefs: AppPreferences | undefined, s: AgentSessionInfo): boolean {
  return prefs?.asyncQuestions !== false || !providerAdapter(s.provider).native?.blockingQuestions
}
