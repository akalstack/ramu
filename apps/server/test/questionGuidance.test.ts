import { expect, it } from 'vitest'
import { sessionGuidance, type GuidanceSections } from '../src/agent/guidance'
import { INTEGRATED_BROWSER_GUIDE } from '../src/browser/tools'
import { QUESTION_INPUT_GUIDANCE } from '@ramu/shared/chat/questions'

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
