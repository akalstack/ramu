import { expect, it } from 'vitest'
import { asideDraft } from '../src/chat/asideDraft'

const message = (role: 'user' | 'assistant', text: string, extra: { quote?: string; error?: true } = {}) => ({
  id: text,
  role,
  text,
  at: 1,
  ...extra,
})

it('opens a thread with each passage, question and answer, ready for what comes next', () => {
  expect(
    asideDraft([
      message('user', 'Why a queue?', { quote: 'Use a queue here.\nIt keeps order.' }),
      message('assistant', 'Because order matters.\nAnd retries.'),
    ]),
  ).toBe('> Use a queue here.\n> It keeps order.\n\nWhy a queue?\n\n> Because order matters.\n> And retries.\n\n')
})

it('leaves out a failed answer, and an empty side chat carries nothing', () => {
  expect(asideDraft([message('user', 'What changed?'), message('assistant', 'Limit', { error: true })])).toBe(
    'What changed?\n\n',
  )
  expect(asideDraft([])).toBe('')
})
