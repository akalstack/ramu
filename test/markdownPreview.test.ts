import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { previewImagePath, previewRehypePlugins, previewRemarkPlugins, previewRemarkRehypeOptions, previewUrlTransform } from '../src/shared/markdownRendering'

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, {
  remarkPlugins: previewRemarkPlugins, rehypePlugins: previewRehypePlugins,
  remarkRehypeOptions: previewRemarkRehypeOptions, urlTransform: previewUrlTransform, children: text,
}))

describe('Markdown file preview', () => {
  it('renders README HTML with centered pictures, dimensions, and dark-mode sources', () => {
    const html = render('<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" /><img src="assets/logo-light.svg" alt="Ramu" width="300" /></picture><br /><strong>Your project.</strong></p>')
    expect(html).toContain('<p align="center">')
    expect(html).toContain('<picture>')
    expect(html).toContain('media="(prefers-color-scheme: dark)"')
    expect(html).toContain('srcSet="assets/logo.svg"')
    expect(html).toContain('width="300"')
    expect(html).toContain('<strong>Your project.</strong>')
    expect(html).not.toContain('&lt;picture')
  })
  it.each(['---\ntitle: Example\n---', '+++\ntitle = "Example"\n+++'])('shows frontmatter as metadata: %s', (frontmatter) => {
    const html = render(`${frontmatter}\n\n# Body`)
    expect(html).toContain('<details class="md-frontmatter"><summary>Frontmatter</summary>')
    expect(html).toContain('title')
    expect(html).toContain('<h1>Body</h1>')
    expect(html).not.toContain('<hr')
  })
  it('preserves thematic breaks and fenced code that resemble frontmatter or HTML', () => {
    const html = render('# Body\n\n---\n\n```html\n<strong>Literal</strong>\n```')
    expect(html).toContain('<hr/>')
    expect(html).toContain('&lt;strong&gt;Literal&lt;/strong&gt;')
    expect(html).not.toContain('Frontmatter')
  })
  it('removes scripts, event handlers, frames, and executable URLs', () => {
    const html = render('<script>alert(1)</script><iframe src="https://example.com"></iframe><img src="x.png" onerror="alert(1)" /><a href="javascript:alert(1)">Click</a>')
    expect(html).not.toMatch(/<script|<iframe|onerror|javascript:/)
    expect(previewUrlTransform('javascript:alert(1)')).toBe('')
    expect(previewUrlTransform('file:///private.txt')).toBe('')
  })
  it('resolves relative assets from nested documents and encoded filenames', () => {
    expect(previewImagePath('docs/guide.md', '../assets/logo.svg')).toBe('assets/logo.svg')
    expect(previewImagePath('docs/guide.md', './screen%20shot.png')).toBe('docs/screen shot.png')
    expect(previewImagePath('README.md', '/assets/logo.svg')).toBe('assets/logo.svg')
    expect(previewImagePath('README.md', 'https://example.com/logo.png')).toBeNull()
    expect(previewImagePath('README.md', '#heading')).toBeNull()
  })
})
