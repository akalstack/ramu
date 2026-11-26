import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ThinkingRow } from '../src/views/agent/components/ThinkingRow'

vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/chat/ChatMarkdown', () => ({ chatMarkdownComponents: {} }))

it('leads with the brain icon and the thought itself, naming the row only for screen readers', () => {
  for (const active of [false, true]) {
    // A finished paragraph: a thought that ended, or one streaming past its first paragraph.
    const html = renderToStaticMarkup(createElement(ThinkingRow, { text: 'Checking the config next\n\n', active }))
    expect(html).toContain('lucide-brain')
    expect(html).toContain('Checking the config next')
    expect(html).toContain(`<span class="sr-only">${active ? 'Thinking' : 'Thought'}</span>`)
    expect(html.replace(/<span class="sr-only">[^<]*<\/span>/, '')).not.toMatch(/Thinking|Thought/)
  }
})

it('says Thinking, not half a sentence, while a thought is still on its first paragraph', () => {
  const html = renderToStaticMarkup(createElement(ThinkingRow, { text: 'Checking the conf', active: true }))
  expect(html).not.toContain('Checking the conf')
  expect(html).not.toContain('sr-only')
  expect(html).toContain('Thinking')
})
