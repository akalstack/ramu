import { expect, it } from 'vitest'
import { sessionGuidance, type GuidanceSections } from '../src/agent/guidance'
import { INTEGRATED_BROWSER_GUIDE } from '../src/browser/tools'
import { INTERACTIVE_GUIDE } from '../src/interactive/tools'
import { NATIVE_TOOL_DISCOVERY_INSTRUCTIONS, TOOL_DISCOVERY_INSTRUCTIONS } from '../src/intelligence'
import { QUESTION_INPUT_GUIDANCE } from '@ramu/shared/chat/questions'
import { NO_AGENT_CREDITS_GUIDANCE } from '@ramu/shared/workspace/agentCredits'

it.each(['async', 'blocking'] as const)('explains free-text-only questions with %s questions enabled', (questions) => {
  const sections: GuidanceSections = {
    questions,
    background: false,
    advisor: false,
    goal: null,
    nativeSubagentNote: false,
    memory: undefined,
    toolSearch: false,
    learning: undefined,
  }
  expect(sessionGuidance(sections)).toContain(QUESTION_INPUT_GUIDANCE)
})

it('adds the selected integrated-browser policy without claiming native tools were suppressed', () => {
  const sections: GuidanceSections = {
    questions: 'native',
    background: false,
    advisor: false,
    goal: null,
    nativeSubagentNote: false,
    memory: undefined,
    toolSearch: true,
    learning: undefined,
  }
  expect(sessionGuidance(sections)).not.toContain(INTEGRATED_BROWSER_GUIDE)
  const guidance = sessionGuidance({ ...sections, browser: INTEGRATED_BROWSER_GUIDE })
  expect(guidance).toContain(INTEGRATED_BROWSER_GUIDE)
  expect(guidance).toContain('Never bypass human control')
  expect(guidance).toContain('do not silently switch browser backends')
})

it('asks every agent to leave its credits out of commits and pull requests when the person removes them', () => {
  const sections: GuidanceSections = {
    questions: 'native',
    background: false,
    advisor: false,
    goal: null,
    nativeSubagentNote: false,
    memory: undefined,
    toolSearch: false,
    learning: undefined,
  }
  expect(sessionGuidance(sections)).not.toContain(NO_AGENT_CREDITS_GUIDANCE)
  expect(sessionGuidance({ ...sections, noCredits: true })).toContain(NO_AGENT_CREDITS_GUIDANCE)
})

it('keeps the artifact guide under a provider’s own tool search, pointing at that search instead of tool_search', () => {
  const sections: GuidanceSections = {
    questions: 'native',
    background: false,
    advisor: false,
    goal: null,
    nativeSubagentNote: false,
    memory: undefined,
    toolSearch: false,
    nativeToolSearch: true,
    learning: undefined,
  }
  const guidance = sessionGuidance(sections)
  expect(guidance).toContain(INTERACTIVE_GUIDE)
  expect(guidance).toContain(NATIVE_TOOL_DISCOVERY_INSTRUCTIONS)
  expect(guidance).not.toContain(TOOL_DISCOVERY_INSTRUCTIONS)
  expect(sessionGuidance({ ...sections, toolSearch: true })).toContain(TOOL_DISCOVERY_INSTRUCTIONS)
  expect(sessionGuidance({ ...sections, nativeToolSearch: false })).not.toContain(INTERACTIVE_GUIDE)
})
