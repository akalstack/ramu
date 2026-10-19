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

/** Ramu's question tools serve a chat unless async questions are off and the provider has its own blocking question tool. */
export function usesRamuQuestionTools(asyncQuestions: boolean, s: AgentSessionInfo): boolean {
  return asyncQuestions || !providerAdapter(s.provider).native?.blockingQuestions
}
