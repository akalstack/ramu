import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AgentSessionInfo, type AppPreferences } from '@ramu/shared/types'
import { nativeAdvisorModel, usesRamuQuestions } from '../src/agent/nativeFeatures'

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
    expect(usesRamuQuestions(DEFAULT_APP_PREFERENCES, chat('codex'))).toBe(true)
    expect(usesRamuQuestions(blocking, chat('codex'))).toBe(false)
    expect(usesRamuQuestions(blocking, chat('claude-code'))).toBe(false)
    expect(usesRamuQuestions(blocking, chat('cursor'))).toBe(true)
  })
})
