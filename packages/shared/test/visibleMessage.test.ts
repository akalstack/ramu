import { expect, it } from 'vitest'
import { agentReadable, replaceVisibleMessage, visibleMessage } from '../src/chat/visibleMessage'

it("shows only what the person wrote: Ramu's guidance and appended context are left out", () => {
  const sent = `<chat-context>\nASSISTANT: Hi\n</chat-context>\n<ramu-session-guidance>\nUse tools.\n</ramu-session-guidance>\n\ngreat\n\n<ramu-context>\nfiles\n</ramu-context>`
  expect(visibleMessage(sent)).toBe('great')
  expect(visibleMessage('plain words')).toBe('plain words')
  // Tags the person typed in the middle of a message stay.
  expect(visibleMessage('explain <chat-context> please')).toBe('explain <chat-context> please')
})

it('replaces only what the person wrote, keeping leading blocks and appended context', () => {
  const text = '<ramu-handoff>note</ramu-handoff>\nold words\n\n<ramu-context>\nFiles\n</ramu-context>'
  expect(replaceVisibleMessage(text, 'new words')).toBe(
    '<ramu-handoff>note</ramu-handoff>\nnew words\n\n<ramu-context>\nFiles\n</ramu-context>',
  )
  expect(visibleMessage(replaceVisibleMessage(text, 'new words'))).toBe('new words')
  expect(replaceVisibleMessage('plain', 'changed')).toBe('changed')
})

it('reads a whole message as the agent did, its appended context as plain paragraphs', () => {
  expect(agentReadable('Review comments arrived.\n\n<ramu-context>\nVerify the branch first.\n</ramu-context>')).toBe(
    'Review comments arrived.\n\nVerify the branch first.',
  )
  expect(agentReadable('Nothing hidden')).toBe('Nothing hidden')
})
