import { describe, expect, it } from 'vitest'
import { foldSettingsChanges, sameAgentSettings } from '../src/chat/settingsChanges'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../src/types'

type Row = { kind: 'text'; text: string } | { kind: 'change'; settings: AgentSettings; previous?: AgentSettings }
const opus = { ...DEFAULT_AGENT_SETTINGS, provider: 'claude-code' as const, model: 'opus' }
const work = { ...opus, accountId: 'work' }
const fold = (rows: Row[]) =>
  foldSettingsChanges(
    rows,
    (row) => (row.kind === 'change' ? row : null),
    (first, last) => (first.kind === 'change' && last.kind === 'change' ? { ...last, previous: first.previous } : last),
  )

describe('settings changes in a conversation', () => {
  it('leaves no line for a change that ends where it began, however many steps it took', () => {
    const rows: Row[] = [
      { kind: 'text', text: 'hi' },
      { kind: 'change', previous: opus, settings: work },
      { kind: 'change', previous: work, settings: opus },
      { kind: 'change', previous: opus, settings: work },
      { kind: 'change', previous: work, settings: opus },
    ]
    expect(fold(rows)).toEqual([{ kind: 'text', text: 'hi' }])
  })

  it('reads back-to-back changes as one, and keeps changes that something was said between', () => {
    const sonnet = { ...opus, model: 'sonnet' }
    const rows: Row[] = [
      { kind: 'change', previous: opus, settings: work },
      { kind: 'change', previous: work, settings: sonnet },
      { kind: 'text', text: 'go' },
      { kind: 'change', previous: sonnet, settings: opus },
    ]
    expect(fold(rows)).toEqual([
      { kind: 'change', previous: opus, settings: sonnet },
      { kind: 'text', text: 'go' },
      { kind: 'change', previous: sonnet, settings: opus },
    ])
  })
})

describe('a pending settings choice', () => {
  it('is no change when every chosen field matches once defaults are filled in', () => {
    expect(sameAgentSettings(opus, { ...opus })).toBe(true)
    expect(sameAgentSettings(opus, { ...opus, accountId: 'default' })).toBe(true)
  })

  it('is a change for the model, provider, effort, access, tier, fallback or login', () => {
    expect(sameAgentSettings(opus, { ...opus, model: 'sonnet' })).toBe(false)
    expect(sameAgentSettings(opus, { ...opus, provider: 'codex' })).toBe(false)
    expect(sameAgentSettings(opus, { ...opus, effort: 'high' })).toBe(false)
    expect(sameAgentSettings(opus, { ...opus, access: 'edits' })).toBe(false)
    expect(sameAgentSettings(opus, { ...opus, serviceTier: 'fast' })).toBe(false)
    expect(sameAgentSettings(opus, { ...opus, autoFallback: !opus.autoFallback })).toBe(false)
    expect(sameAgentSettings(opus, work)).toBe(false)
  })
})
