import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ChatMarkdownImage } from '../src/chat/ChatImage'

vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, values?: Record<string, string>) => text.replace('{0}', values?.['0'] ?? ''),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: vi.fn(() => new Promise(() => {})) }) }))

const render = (src: string, taskId?: string) =>
  renderToStaticMarkup(createElement(ChatMarkdownImage, { src, alt: 'Home page', taskId }))

it('draws a web image at once as a control that opens it larger', () => {
  const html = render('https://example.com/home.png')
  expect(html).toContain('src="https://example.com/home.png"')
  expect(html).toContain('aria-label="Open Home page larger"')
})

it('waits for a workspace image from the host instead of pointing the page at a path it cannot read', () => {
  const html = render('screens/home.png', 'task')
  expect(html).not.toContain('<img')
  expect(html).toContain('Home page')
})

it('never points the page at a workspace path outside a thread', () => {
  expect(render('screens/home.png')).not.toContain('<img')
})
