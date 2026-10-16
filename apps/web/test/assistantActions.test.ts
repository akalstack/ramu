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
const render = (props: Partial<ComponentProps<typeof AssistantText>> = {}) =>
  renderToStaticMarkup(createElement(AssistantText, { event, generating: false, ...props }))

it('gives completed replies all four actions without needing latest-message status', () => {
  const html = render()
  for (const label of ['Copy', 'Quote in your message', 'Ask aside about this message', 'Quote in new thread']) {
    expect(html).toContain(`aria-label="${label}"`)
  }
  const toolbarClass = html.match(/class="(msg-actions[^"]*)"/)?.[1]
  expect(toolbarClass).toBeDefined()
  expect(toolbarClass?.split(' ')).toContain('opacity-0')
  expect(toolbarClass?.split(' ')).not.toContain('always')
  expect(toolbarClass).toContain('[&amp;:focus-within]:opacity-100')
  expect(html).toContain('[&amp;.assistant:hover_.msg-actions]:opacity-100')
})

it('keeps only the latest completed reply’s actions always visible', () => {
  const html = render({ latest: true })
  const toolbarClass = html.match(/class="(msg-actions[^"]*)"/)?.[1]
  expect(toolbarClass?.split(' ')).toContain('always')
  expect(html).toContain('aria-label="Copy"')
})

it('waits for a streaming reply to finish before offering message actions', () => {
  expect(render({ generating: true, latest: true })).not.toContain('aria-label="Copy"')
})

it('preserves explicit opt-outs in embedded transcripts', () => {
  expect(render({ actions: false })).not.toContain('aria-label="Copy"')
})
