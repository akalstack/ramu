import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ ref: null as { current: unknown } | null, effects: [] as (() => void)[] }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: (initial: unknown) => (state.ref ??= { current: initial }),
  useEffect: (run: () => void) => {
    state.effects.push(run)
  },
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/chat/ChatMarkdown', () => ({ chatMarkdownComponents: {} }))
vi.mock('../src/chat/ChatImage', () => ({ ChatMarkdownImage: () => null }))
vi.mock('../src/chat/ChatReferences', () => ({ ChatLink: ({ children }: React.PropsWithChildren) => children }))
vi.mock('../src/views/agent/components/MessageTime', () => ({ MessageTime: () => null }))
vi.mock('../src/views/agent/components/CopyButton', () => ({ CopyButton: () => null }))
vi.mock('../src/views/agent/components/MessageQuoteActions', () => ({ MessageQuoteActions: () => null }))
vi.mock('../src/views/agent/components/UserMessage', () => ({
  UserBubble: ({ children }: React.PropsWithChildren) => createElement('div', {}, children),
}))
vi.mock('../src/composer/Attachments', () => ({ Attachments: () => null }))
import { AssistantText } from '../src/views/agent/components/AssistantText'
import { PendingSubmission } from '../src/views/agent/components/PendingSubmission'
beforeEach(() => {
  vi.useFakeTimers()
  state.ref = null
  state.effects = []
})
afterEach(() => {
  vi.useRealTimers()
})
const render = (text: string, generating = true) => {
  const html = renderToStaticMarkup(
    createElement(AssistantText, { event: { kind: 'text', text }, generating, actions: false }),
  )
  for (const effect of state.effects.splice(0)) effect()
  return html
}
it('draws a streaming reply a block at a time and marks it for the block fade', () => {
  const html = render('First paragraph.\n\n- one\n- two\n\nLast words')
  expect(html).toContain('data-streaming=""')
  expect(html).toContain('<p>First paragraph.</p>')
  expect(html).toContain('<li>one</li>')
  expect(html).toContain('<p>Last words</p>')
  expect(html).not.toContain('stream-word')
})
it('keeps code blocks and tables whole inside their own block', () => {
  const html = render('| Column |\n| --- |\n| Cell |\n\n```js\nconst a = 1\n\nconst b = 2\n```')
  expect(html).toContain('<td>Cell</td>')
  expect(html).toContain('const a = 1\n\nconst b = 2')
})
it('shows a finished reply settled, with no fade', () => {
  const html = render('Hello\n\nthere', false)
  expect(html).not.toContain('data-streaming')
  expect(html).toContain('<p>there</p>')
})
it('shows the outgoing message immediately without a Sending label', () => {
  const html = renderToStaticMarkup(
    createElement(PendingSubmission, {
      submission: {
        id: 'a',
        text: 'My message',
        attachments: [],
        afterEvent: 0,
        queuedIds: [],
        sentAt: 1,
        state: 'sending',
        payload: { outgoing: 'My message', mode: 'queue', context: [], compactFirst: false, reviews: [] },
      },
      onRetry: () => {},
      onEdit: () => {},
      onRemove: () => {},
    }),
  )
  expect(html).toContain('My message')
  expect(html).not.toContain('Sending')
})
