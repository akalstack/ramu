import { expect, it } from 'vitest'
import { visibleMessage } from '../src/chat/visibleMessage'
import { teammateCatchUp } from '../src/chat/teammateMentions'

it("shows only what the person wrote: Ramu's catch-up, guidance and appended context are left out", () => {
  const sent = `${teammateCatchUp('ASSISTANT: Hi', ['a.ts'])}<ramu-session-guidance>\nUse tools.\n</ramu-session-guidance>\n\ngreat\n\n<ramu-context>\nfiles\n</ramu-context>`
  expect(visibleMessage(sent)).toBe('great')
  expect(visibleMessage('plain words')).toBe('plain words')
  // Tags the person typed in the middle of a message stay.
  expect(visibleMessage('explain <thread-catch-up> please')).toBe('explain <thread-catch-up> please')
})
