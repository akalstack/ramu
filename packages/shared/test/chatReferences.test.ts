import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { chatReferences, remarkChatReferences, SKILL_REFERENCE_PREFIX } from '../src/chat/chatReferences'
import { localFileLink } from '../src/workspace/fileLinks'

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkChatReferences],
      urlTransform: (url) =>
        url.startsWith(SKILL_REFERENCE_PREFIX) || localFileLink(url) ? url : defaultUrlTransform(url),
      children: text,
    }),
  )

describe('inline thread references', () => {
  it('recognizes skill calls and repository-qualified file mentions without changing the message', () => {
    const text = 'Use $artifact-template-operating-review with @"ramu/src/App.tsx".'
    const parts = chatReferences(text)
    expect(parts.filter((part) => part.kind !== 'text')).toEqual([
      { kind: 'skill', text: '$artifact-template-operating-review', target: 'artifact-template-operating-review' },
      { kind: 'file', text: '@"ramu/src/App.tsx"', target: 'ramu/src/App.tsx' },
    ])
    expect(parts.map((part) => part.text).join('')).toBe(text)
  })
  it('supports skill namespaces and file line suffixes', () => {
    const parts = chatReferences('$spreadsheets:Spreadsheets @src/App.tsx:12:3')
    expect(parts.filter((part) => part.kind !== 'text').map((part) => part.target)).toEqual([
      'spreadsheets:Spreadsheets',
      'src/App.tsx:12:3',
    ])
  })
  it('preserves prices, environment variables, code examples, and email addresses', () => {
    const text = '$100 $HOME name@example.com `Use $imagegen`\n```sh\n$imagegen\n```'
    expect(chatReferences(text)).toEqual([{ kind: 'text', text }])
  })
  it('preserves punctuation and supports more than one mention', () => {
    const text = 'Read @README.md, then $shadcn and @src/index.ts.'
    const parts = chatReferences(text)
    expect(parts.map((part) => part.text).join('')).toBe(text)
    expect(parts.filter((part) => part.kind !== 'text').map((part) => part.target)).toEqual([
      'README.md',
      'shadcn',
      'src/index.ts',
    ])
  })
  it('does not interpret ordinary social mentions as files', () => {
    expect(chatReferences('Ask @alice')).toEqual([{ kind: 'text', text: 'Ask @alice' }])
  })
  it('converts Markdown skill calls without nesting or changing existing links', () => {
    const html = render('Use $imagegen and [README](README.md:12). [Site](https://example.com/$imagegen).')
    expect(html).toContain('href="ramu-skill:imagegen"')
    expect(html).toContain('href="README.md:12"')
    expect(html).toContain('href="https://example.com/$imagegen"')
    expect(html.match(/ramu-skill:/g)).toHaveLength(1)
  })
  it('leaves inline and fenced Markdown code alone', () => {
    const html = render('`$imagegen`\n\n```sh\n$imagegen\n```')
    expect(html).not.toContain('ramu-skill:')
  })
})
