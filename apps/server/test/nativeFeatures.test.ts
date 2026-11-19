import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AgentSessionInfo, type AppPreferences } from '@ramu/shared/types'
import {
  nativeAdvisorModel,
  usesRamuQuestionTools,
  usesRamuToolScripts,
  usesRamuToolSearch,
} from '../src/agent/nativeFeatures'

const chat = (provider: AgentSessionInfo['provider'], parentId?: string) =>
  ({ provider, ...(parentId ? { parentId } : {}) }) as AgentSessionInfo
const advisor = (provider: AgentSessionInfo['provider']): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  advisor: { enabled: true, wait: false, step: { id: 's', provider, model: 'opus', effort: null } },
})

describe('native-first provider features', () => {
  it("uses Claude Code's own advisor when the advisor step is on Claude", () => {
    expect(nativeAdvisorModel(advisor('claude-code'), chat('claude-code'))).toBe('opus')
    // Another provider, a sub-agent, or a provider without one: Ramu's advisor.
    expect(nativeAdvisorModel(advisor('codex'), chat('claude-code'))).toBeNull()
    expect(nativeAdvisorModel(advisor('claude-code'), chat('claude-code', 'parent'))).toBeNull()
    expect(nativeAdvisorModel(advisor('codex'), chat('codex'))).toBeNull()
    expect(nativeAdvisorModel(DEFAULT_APP_PREFERENCES, chat('claude-code'))).toBeNull()
  })

  it("keeps Ramu's questions for async answers and providers without a native question tool", () => {
    const blocking = { ...DEFAULT_APP_PREFERENCES, asyncQuestions: false }
    expect(usesRamuQuestionTools(DEFAULT_APP_PREFERENCES.asyncQuestions, chat('codex'))).toBe(true)
    expect(usesRamuQuestionTools(blocking.asyncQuestions, chat('codex'))).toBe(false)
    expect(usesRamuQuestionTools(blocking.asyncQuestions, chat('claude-code'))).toBe(false)
    expect(usesRamuQuestionTools(blocking.asyncQuestions, chat('cursor'))).toBe(true)
  })

  it("uses a provider's own tool search, keeping Ramu's only where the provider has none", () => {
    for (const provider of ['claude-code', 'codex', 'opencode'] as const)
      expect(usesRamuToolSearch(true, chat(provider)), provider).toBe(false)
    for (const provider of ['antigravity', 'cursor'] as const)
      expect(usesRamuToolSearch(true, chat(provider)), provider).toBe(true)
    expect(usesRamuToolSearch(false, chat('cursor'))).toBe(false)
  })

  it('offers run_script except where the provider already scripts MCP calls', () => {
    expect(usesRamuToolScripts(chat('claude-code'))).toBe(true)
    expect(usesRamuToolScripts(chat('opencode'))).toBe(false)
  })
})
