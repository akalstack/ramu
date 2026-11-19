import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { AssistantText } from '../src/views/agent/components/AssistantText'

vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string) => text,
  formatLocale: () => 'en-US',
}))
vi.mock('../src/chat/ChatCodeBlock', () => ({ chatCodeComponents: {} }))
vi.mock('../src/ipc', () => ({ copyText: vi.fn() }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/chat/ChatReferences', () => ({
  ChatLink: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../src/commands', () => ({ formatKeys: (keys: string) => keys }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => createElement('button', props),
}))
vi.mock('../src/views/agent/components/CopyButton', () => ({
  CopyButton: () => createElement('button', { 'aria-label': 'Copy' }),
}))

const event = { kind: 'text' as const, text: 'An earlier agent reply.', at: 1_800_000_000_000 }
/** Classes of the shadcn message footer that holds the actions. */
const footerClasses = (html: string) => html.match(/<div data-slot="message-footer" class="([^"]*)"/)?.[1]?.split(' ')
const render = (props: Partial<ComponentProps<typeof AssistantText>> = {}) =>
  renderToStaticMarkup(createElement(AssistantText, { event, generating: false, ...props }))

it('gives completed replies all four actions without needing latest-message status', () => {
  const html = render()
  for (const label of ['Copy', 'Quote in your message', 'Ask aside about this message', 'Quote in new thread']) {
    expect(html).toContain(`aria-label="${label}"`)
  }
  const classes = footerClasses(html)
  expect(classes).toBeDefined()
  expect(classes).toContain('opacity-0')
  expect(classes).toContain('group-hover/message:opacity-100')
  expect(classes).toContain('focus-within:opacity-100')
})

it('keeps only the latest completed reply’s actions always visible', () => {
  const html = render({ latest: true })
  const classes = footerClasses(html)
  expect(classes).toContain('opacity-100')
  expect(classes).not.toContain('opacity-0')
  expect(html).toContain('aria-label="Copy"')
})

it('waits for a streaming reply to finish before offering message actions', () => {
  expect(render({ generating: true, latest: true })).not.toContain('aria-label="Copy"')
})

it('preserves explicit opt-outs in embedded transcripts', () => {
  expect(render({ actions: false })).not.toContain('aria-label="Copy"')
})
