import { expect, it } from 'vitest'
import { sessionGuidance, type GuidanceSections } from '../src/agent/guidance'
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
