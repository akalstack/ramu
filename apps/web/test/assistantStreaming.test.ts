import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
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
  state.ref = null
  state.effects = []
})
const render = (text: string, generating = true) => {
  const html = renderToStaticMarkup(
    createElement(AssistantText, { event: { kind: 'text', text }, generating, actions: false }),
  )
  for (const effect of state.effects.splice(0)) effect()
  return html
}
it('settles existing text and fades only appended words without stagger or whole-reply motion', () => {
  const first = render('Hello there')
  expect(first.match(/class="stream-word"/g)).toHaveLength(2)
  expect(first).toContain('stream-in 120ms ease-out both')
  const appended = render('Hello there friend')
  expect(appended.match(/class="stream-word"/g)).toHaveLength(1)
  expect(appended).toContain('Hello there ')
  expect(appended).not.toContain('animation-delay')
  expect(appended).not.toContain('animation:arrive')
})
it('shows reopened reply history immediately and fades only its new suffix', () => {
  const history = 'Existing content '.repeat(20)
  expect(render(history)).not.toContain('class="stream-word"')
  expect(render(history + 'new')).toContain('class="stream-word"')
})
it('shows the complete final reply without retaining a delayed animation queue', () => {
  render('Hello')
  expect(render('Hello there', false)).not.toContain('class="stream-word"')
})
it('shows the outgoing message immediately without a Sending label', () => {
  const html = renderToStaticMarkup(
    createElement(PendingSubmission, {
      submission: { text: 'My message', attachments: [], afterEvent: 0, queuedIds: [] },
    }),
  )
  expect(html).toContain('My message')
  expect(html).not.toContain('Sending')
})
