import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it, vi } from 'vitest'

// The code frame pulls in Monaco, which needs a browser; the markdown map only spreads it in.
vi.mock('../src/chat/ChatCodeBlock', () => ({ chatCodeComponents: {} }))
vi.mock('../src/ipc', () => ({ copyText: vi.fn() }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
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

    // Copy sits over the top-right corner, so the header's last cell keeps room for it.
    expect(html).toContain('thead_th:last-child]:pr-10')
  })

  it('draws task lists with disabled shadcn checkboxes, leaving list and quote looks to the reading frame', () => {
    const html = render('- [x] done\n- [ ] todo')
    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('class="contains-task-list"')
    expect(render('- one\n- two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>')
    expect(render('> quoted')).toBe('<blockquote>\n<p>quoted</p>\n</blockquote>')
  })

  it('draws rules as separators', () => {
    expect(render('a\n\n---\n\nb')).toContain('data-slot="separator"')
  })
})
