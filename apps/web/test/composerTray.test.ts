import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ComposerStack } from '../src/composer/ComposerStack'
import { ComposerTray } from '../src/composer/ComposerTray'
import { ComposerTraySection } from '../src/composer/ComposerTraySection'
import { TrayStack } from '../src/composer/TrayStack'

vi.mock('@/components/desktop-button', () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<'button'> & { variant?: string }) =>
    createElement('button', props),
}))

const section = (open: boolean) =>
  renderToStaticMarkup(
    createElement(ComposerTraySection, {
      title: 'Queued messages 2',
      icon: createElement('i'),
      open,
      actions: createElement('button', {}, 'Resume messages'),
      children: createElement('input', { defaultValue: 'Draft answer' }),
    }),
  )

it('keeps trays and the composer inside one constrained column', () => {
  const html = renderToStaticMarkup(
    createElement(
      ComposerStack,
      {},
      createElement(ComposerTray, {}, 'Context'),
      createElement('form', { className: 'composer' }, 'Message'),
    ),
  )
  expect(html).toMatch(/^<div class="composer-stack"><div class="composer-tray">Context<\/div><form/)
})

it('exposes the disclosure state and keeps independent actions outside the trigger', () => {
  const html = section(true)
  expect(html).toContain('aria-expanded="true"')
  expect(html).toMatch(/aria-controls="[^"]+"/)
  expect(html.indexOf('Resume messages')).toBeGreaterThan(html.indexOf('</button>'))
  expect(html).not.toContain('hidden=""')
})

it('retains draft fields in the hidden panel while leaving header actions available', () => {
  const html = section(false)
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('hidden=""')
  expect(html).toContain('value="Draft answer"')
  expect(html.indexOf('Resume messages')).toBeLessThan(html.indexOf('hidden=""'))
})

it('shows a section count after its title with a dot separator that screen readers skip', () => {
  const html = renderToStaticMarkup(
    createElement(ComposerTraySection, { title: 'Teammates', count: 2, icon: createElement('i') }),
  )
  expect(html).toMatch(/Teammates<span aria-hidden="true"[^>]*>·<\/span><span[^>]*>2<\/span>/)
  expect(
    renderToStaticMarkup(createElement(ComposerTraySection, { title: 'Computer', icon: createElement('i') })),
  ).not.toContain('·')
})

it('keeps the first live card in the tray and lifts the rest into the layer above it', () => {
  const html = renderToStaticMarkup(
    createElement(TrayStack, {
      summary: [],
      children: [
        false,
        createElement('section', { id: 'agents', key: 'agents' }),
        null,
        createElement('section', { id: 'browser', key: 'browser' }),
        createElement('section', { id: 'goal', key: 'goal' }),
      ],
    }),
  )
  expect(html).toBe(
    '<div class="composer-tray-stack"><div class="composer-tray-first"><section id="agents"></section></div><div class="composer-tray-spread"><section id="browser"></section><section id="goal"></section></div></div>',
  )
  expect(
    renderToStaticMarkup(createElement(TrayStack, { summary: [], children: createElement('section', { id: 'only' }) })),
  ).toBe('<div class="composer-tray-stack"><div class="composer-tray-first"><section id="only"></section></div></div>')
  expect(renderToStaticMarkup(createElement(TrayStack, { summary: [], children: [false, null] }))).toBe('')
})

it('names every kind of live work on the folded row once there is more than one', () => {
  const summary = [
    { key: 'browser', icon: createElement('i'), label: 'Browser', count: 1 },
    { key: 'servers', icon: createElement('i'), label: 'Servers', count: 2 },
    { key: 'goal', icon: createElement('i'), label: 'Goal' },
  ]
  const cards = [createElement('section', { key: 'a' }), createElement('section', { key: 'b' })]
  const html = renderToStaticMarkup(createElement(TrayStack, { summary, children: cards }))
  const row = html.match(/<div aria-hidden="true" class="composer-tray-summary">.*?<\/svg><\/div>/)?.[0] ?? ''
  expect(row.replace(/<[^>]+>/g, '')).toBe('Browser1·Servers2·Goal')
  // A single card is its own row; there is nothing to sum up.
  expect(
    renderToStaticMarkup(createElement(TrayStack, { summary: summary.slice(0, 1), children: cards[0] })),
  ).not.toContain('composer-tray-summary')
})
