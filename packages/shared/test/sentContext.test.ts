import { expect, it } from 'vitest'
import { hasSentContext, sentContext, sentReviewComments } from '../src/chat/sentContext'
import { terminalAttachment, terminalAttachmentBlock } from '../src/chat/terminalContext'
import { visibleMessage, withHiddenContext } from '../src/chat/visibleMessage'

it('appends hidden context in one block that the visible text leaves out', () => {
  const excerpt = terminalAttachment('Terminal 2', [3, 4], 'npm test\nFAIL a.test.ts', 'x')!
  const sent = withHiddenContext('fix this', terminalAttachmentBlock([excerpt]))
  expect(visibleMessage(sent)).toBe('fix this')
  expect(withHiddenContext('plain', '')).toBe('plain')
  const context = sentContext(sent)
  expect(context.terminal).toEqual([{ terminal: 'Terminal 2', lines: [3, 4], text: 'npm test\nFAIL a.test.ts' }])
  expect(hasSentContext(context)).toBe(true)
  expect(hasSentContext(sentContext('nothing hidden'))).toBe(false)
})

it('reads review comments back and skips entries it cannot use', () => {
  const payload = JSON.stringify([
    { path: 'a.ts', side: 'new', line: 4, endLine: 6, originalComment: 'Rename this' },
    { path: 'b.ts', side: 'old', line: 1, endLine: 1, scope: 'file', originalComment: 'Why?' },
    { path: 'c.ts', side: 'sideways', line: 1, endLine: 1, originalComment: 'bad side' },
  ])
  expect(sentReviewComments(`look\n<review-comments>${payload}</review-comments>`)).toEqual([
    { path: 'a.ts', side: 'new', line: 4, endLine: 6, text: 'Rename this' },
    { path: 'b.ts', side: 'old', line: 1, endLine: 1, scope: 'file', text: 'Why?' },
  ])
  expect(sentReviewComments('<review-comments>not json</review-comments>')).toEqual([])
})
