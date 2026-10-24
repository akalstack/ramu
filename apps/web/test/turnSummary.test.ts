import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { TurnSummary } from '../src/views/agent/components/TurnSummary'
vi.mock('../src/i18n', () => ({ useLanguage() {} }))
it('uses the muted tool-row color for the worked-for label', () => {
  const html = renderToStaticMarkup(createElement(TurnSummary, { label: 'Worked for 20s', children: 'steps' }))
  expect(html).toMatch(/class="[^"]*text-muted-foreground[^"]*">Worked for 20s/)
})

it('composes the marker and collapsible as one native keyboard-operable button', () => {
  const html = renderToStaticMarkup(createElement(TurnSummary, { label: 'Worked for 20s', children: 'steps' }))
  const buttons = html.match(/<button\b[^>]*>/g) ?? []
  expect(buttons).toHaveLength(1)
  expect(buttons[0]).toContain('type="button"')
  expect(buttons[0]).toContain('aria-expanded="false"')
  expect(buttons[0]).toContain('data-slot="collapsible-trigger"')
})
