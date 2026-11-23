import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { proseVariables } from '@ramu/shared/prose'

// The code frame pulls in Monaco, which needs a browser; these tests only check the reading frame around it.
vi.mock('../src/chat/ChatCodeBlock', () => ({ chatCodeComponents: {}, ChatCodePre: () => null }))
vi.mock('../src/ipc', () => ({ copyText: vi.fn() }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
const { MarkdownText } = await import('../src/chat/MarkdownText')
const { PullRequestMarkdown } = await import('../src/git/PullRequestMarkdown')
const { ReviewMarkdownDiff } = await import('../src/changes/ReviewMarkdownDiff')

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

describe('MarkdownText', () => {
  it('sets Markdown in the shared reading frame, as a reply unless a surface asks otherwise', () => {
    const reply = html(createElement(MarkdownText, { children: '## Plan\n\n- one' }))
    expect(reply).toMatch(/^<div class="ramu-prose" data-density="reply"><h2>Plan<\/h2>/)
    expect(reply).toContain('<li>one</li>')

    const card = html(createElement(MarkdownText, { density: 'compact', className: 'text-soft', children: 'note' }))
    expect(card).toBe('<div class="ramu-prose text-soft" data-density="compact"><p>note</p></div>')
  })

  it('draws tables with the shared parts by default', () => {
    expect(html(createElement(MarkdownText, { children: '| A |\n| - |\n| 1 |' }))).toContain('data-slot="table"')
  })
})

describe('surfaces reading through MarkdownText', () => {
  it('shows a pull request comment as a card and its description as a reply', () => {
    expect(html(createElement(PullRequestMarkdown, { children: 'Looks **good**' }))).toContain('data-density="compact"')
    const description = html(
      createElement(PullRequestMarkdown, { density: 'reply', children: '# Title\n\n<!-- hidden -->' }),
    )
    expect(description).toContain('data-density="reply"')
    expect(description).not.toContain('hidden')
  })

  it('keeps a reworded heading in a Markdown review at its heading size', () => {
    const file = { path: 'README.md', status: 'modified', oldContent: '## Old name\n', newContent: '## New name\n' }
    const review = html(createElement(ReviewMarkdownDiff, { reviewId: 'r', file } as never))
    expect(review).toContain('class="ramu-prose" data-density="reply"><h2>')
    expect(review).not.toContain('text-xl')
  })
})

describe('prose.css', () => {
  const css = readFileSync(new URL('../src/prose.css', import.meta.url), 'utf8')

  it('reads every value of the shared scale, so the phone and the desktop stay on the same numbers', () => {
    for (const name of Object.keys(proseVariables)) expect(css).toContain(`var(${name})`)
  })

  it('leaves the frame of shadcn parts to the parts themselves', () => {
    expect(css).toContain('table:not([data-slot])')
    expect(css).toContain('pre:not([data-slot] pre)')
  })
})
