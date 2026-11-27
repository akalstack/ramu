import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { answerMessage, parseAnswerMessage } from '@ramu/shared/chat/questions'
import { AnsweredNote } from '../src/views/agent/components/AnsweredNote'

vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (value: string, args: Record<string, string> = {}) =>
    value.replace(/\{(\w+)\}/g, (_, key: string) => args[key] ?? `{${key}}`),
}))

it('shows each question with the answer given under the line that leads back to its card', () => {
  const sent = parseAnswerMessage(
    answerMessage('r1', [
      { question: 'When you click **Changes**, what moves?', answer: 'It moves slightly down' },
      { question: 'Which host?', answer: 'This host' },
    ]),
  )!
  const html = renderToStaticMarkup(createElement(AnsweredNote, { requestId: sent.requestId, body: sent.body }))
  expect(html).toContain('Answered 2 questions')
  expect(html).toContain('When you click Changes, what moves?')
  expect(html).toContain('It moves slightly down')
  expect(html).toContain('Which host?')
  expect(html).toContain('This host')
})
