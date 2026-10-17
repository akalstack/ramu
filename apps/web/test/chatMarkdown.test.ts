import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it, vi } from 'vitest'

// The code frame pulls in Monaco, which needs a browser; the markdown map only spreads it in.
vi.mock('../src/chat/ChatCodeBlock', () => ({ chatCodeComponents: {} }))
const { chatMarkdownComponents } = await import('../src/chat/ChatMarkdown')

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], components: chatMarkdownComponents }, markdown),
  )

describe('chatMarkdownComponents', () => {
  it('draws tables with the shadcn table parts and keeps column alignment', () => {
    const html = render('| Name | Count |\n| --- | ---: |\n| a | 1 |')
    expect(html).toContain('data-slot="table"')
    expect(html).toContain('data-slot="table-head"')
    expect(html).toContain('data-slot="table-cell"')
    expect(html).toContain('text-align:right')
  })

  it('draws task lists with disabled shadcn checkboxes and no bullets', () => {
    const html = render('- [x] done\n- [ ] todo')
    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('list-none')
    expect(html).not.toContain('list-disc')
  })

  it('keeps bullets for ordinary lists', () => {
    expect(render('- one\n- two')).toContain('list-disc')
  })

  it('draws rules as separators and quotes with a left border', () => {
    expect(render('a\n\n---\n\nb')).toContain('data-slot="separator"')
    expect(render('> quoted')).toContain('border-l-2')
  })
})
