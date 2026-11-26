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

/** Ramu's run_script serves a chat unless its provider already runs code that calls MCP tools. */
export function usesRamuToolScripts(s: AgentSessionInfo): boolean {
  return !providerAdapter(s.provider).native?.toolScripts
}

/** Whether the provider finds MCP tools on demand itself, so Ramu lists its tools directly. */
export const nativeToolSearch = (s: AgentSessionInfo): boolean => !!providerAdapter(s.provider).native?.toolSearch

/** Ramu's own tool_search serves a chat when the setting is on and its provider has no tool search of its own. */
export function usesRamuToolSearch(preference: boolean, s: AgentSessionInfo): boolean {
  return preference && !nativeToolSearch(s)
}

/** Whether the provider's own background commands reach Ramu as tasks, so the agent can say which it is waiting on. */
export const tracksBackgroundCommands = (s: AgentSessionInfo): boolean =>
  !!providerAdapter(s.provider).native?.backgroundCommands
