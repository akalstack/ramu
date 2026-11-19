import { expect, it } from 'vitest'
import { markdownHtml } from '../src/chat/richCopy'

it('copies a reply as plain semantic HTML, tables included', () => {
  const html = markdownHtml('## Plan\n\n| Area | State |\n| :--- | ---: |\n| **Docs** | [ok](https://x.dev) |\n\n- one')
  expect(html).toContain('<h2>Plan</h2>')
  expect(html).toContain('<table>')
  expect(html).toContain('<th style="text-align:left">Area</th>')
  expect(html).toContain('<td style="text-align:left"><strong>Docs</strong></td>')
  expect(html).toContain('<a href="https://x.dev">ok</a>')
  expect(html).toContain('<ul>')
  expect(html).not.toContain('class=')
})
