import { describe, expect, it } from 'vitest'
import type { AgentSettings } from '@ramu/shared/types'
import { settingsMatch } from '../src/views/agent/settingsMatch'

const base: AgentSettings = { provider: 'claude-code', model: 'opus', effort: 'medium', access: 'edits', autoFallback: false }

describe('settingsMatch', () => {
  it('treats identical settings as the same, so no pending separator is drawn', () => {
    expect(settingsMatch(base, { ...base })).toBe(true)
    expect(settingsMatch({ ...base, effort: null }, { ...base, effort: null })).toBe(true)
  })

  it('sees a model, provider, effort or access change as pending', () => {
    expect(settingsMatch(base, { ...base, model: 'sonnet' })).toBe(false)
    expect(settingsMatch(base, { ...base, provider: 'codex' })).toBe(false)
    expect(settingsMatch(base, { ...base, effort: 'high' })).toBe(false)
    expect(settingsMatch(base, { ...base, access: 'full' })).toBe(false)
  })
})
