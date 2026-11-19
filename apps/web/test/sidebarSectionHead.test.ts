import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckCheck } from 'lucide-react'
import { expect, it } from 'vitest'
import { SectionHead } from '../src/sidebar/projects/SectionHead'

it('keeps the section label, count and disclosure state accessible together', () => {
  const html = renderToStaticMarkup(
    createElement(SectionHead, {
      title: 'Done',
      icon: CheckCheck,
      count: 6,
      open: false,
      controls: 'done-chats',
      onToggle() {},
    }),
  )
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-controls="done-chats"')
  expect(html).toContain('Done</span>')
  expect(html).toContain('>6</span>')
})

it('shows a zero count and supports sections without a count', () => {
  const props = { title: 'Threads', open: true, controls: 'loose-chats', onToggle() {} }
  const empty = renderToStaticMarkup(createElement(SectionHead, { ...props, count: 0 }))
  expect(empty).toContain('>0</span>')
  expect(empty).toContain('aria-expanded="true"')
  const uncounted = renderToStaticMarkup(createElement(SectionHead, props))
  expect(uncounted).not.toContain('data-slot="badge"')
})
