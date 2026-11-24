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
// Pacing has its own tests (smoothText); here every arrival is shown at once so the fade alone is checked.
vi.mock('../src/views/agent/hooks/useSmoothText', () => ({ useSmoothText: (text: string) => text }))
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
it('settles existing text and fades only appended words without stagger or whole-reply motion', () => {
  const first = render('Hello there')
  expect(first.match(/class="stream-word"/g)).toHaveLength(2)
  expect(first).not.toContain('animation-delay')
  const appended = render('Hello there friend')
  expect(appended.match(/class="stream-word"/g)).toHaveLength(3)
  expect(appended).toContain('<span class="stream-word">Hello</span> <span class="stream-word">there</span>')
  expect(appended).not.toContain('animation-delay')
  expect(appended).not.toContain('animation:arrive')
})
it('keeps word spans stable across repeated chunks so their running animation can finish', () => {
  const first = render('Hello there')
  expect(render('Hello there')).toBe(first)
  expect(render('Hello there friend')).toContain('<span class="stream-word">Hello</span>')
})
it('resumes a word that is rendered again instead of restarting its fade', () => {
  render('Hello')
  vi.advanceTimersByTime(100)
  expect(render('Hello there')).toContain('<span class="stream-word" style="animation-delay:-100ms">Hello</span>')
})
it('never fades settled words again when the text around them changes the markdown', () => {
  render('1. **Ramu** first')
  vi.advanceTimersByTime(1000)
  const html = render('1. **Ramu** first and more\n\n2. second')
  expect(html).not.toContain('<span class="stream-word">Ramu</span>')
  expect(html).not.toContain('<span class="stream-word">first</span>')
  expect(html).toContain('<span class="stream-word">more</span>')
})
it('animates prose inside links, emphasis, headings and tables without wrapping code blocks', () => {
  const html = render(
    '#### Heading\n\n[Linked words](https://example.com) and **bold words**.\n\n| Column |\n| --- |\n| Cell |\n\n```js\nconst answer = 42\n```',
  )
  for (const word of ['Heading', 'Linked', 'words', 'bold', 'Column', 'Cell'])
    expect(html).toContain(`<span class="stream-word">${word}</span>`)
  expect(html).toContain('<code class="language-js">const answer = 42')
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
