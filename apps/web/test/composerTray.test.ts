import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ComposerStack } from '../src/composer/ComposerStack'
import { ComposerTray } from '../src/composer/ComposerTray'
import { ComposerTraySection } from '../src/composer/ComposerTraySection'
import { TrayStack, chipsThatFit } from '../src/composer/TrayStack'

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
    createElement(ComposerTraySection, { title: 'Agents', count: 2, icon: createElement('i') }),
  )
  expect(html).toMatch(/Agents<span aria-hidden="true"[^>]*>·<\/span><span[^>]*>2<\/span>/)
  expect(
    renderToStaticMarkup(createElement(ComposerTraySection, { title: 'Computer', icon: createElement('i') })),
  ).not.toContain('·')
})

it('lays live work out as one row of chips and drops empty slots', () => {
  const html = renderToStaticMarkup(
    createElement(TrayStack, {
      children: [
        false,
        createElement('section', { id: 'agents', key: 'agents' }),
        null,
        createElement('section', { id: 'goal', key: 'goal' }),
      ],
    }),
  )
  expect(html).toBe(
    '<div class="composer-tray-stack"><div class="composer-tray-slot"><section id="agents"></section></div><div class="composer-tray-slot"><section id="goal"></section></div></div>',
  )
  expect(renderToStaticMarkup(createElement(TrayStack, { children: [false, null] }))).toBe('')
})

it('shows a stacked section as a chip with its short name and a card holding the full title and actions', () => {
  const html = renderToStaticMarkup(
    createElement(TrayStack, {
      children: createElement(ComposerTraySection, {
        title: 'Working toward goal: ship the search box',
        chip: 'Working toward goal',
        live: true,
        icon: createElement('i'),
        actions: createElement('button', {}, 'Pause goal'),
        children: createElement('p', {}, 'Details'),
      }),
    }),
  )
  const trigger = html.match(/<button[^>]*composer-tray-chip-trigger[^>]*>.*?<\/button>/)?.[0] ?? ''
  expect(trigger.replace(/<[^>]+>/g, '')).toBe('Working toward goal')
  expect(trigger).toContain('composer-tray-live')
  expect(trigger).toContain('aria-expanded="false"')
  // The card stays mounted while closed, so a draft or live view inside it survives switching chips.
  const card = html.slice(html.lastIndexOf('<div', html.indexOf('composer-tray-card')))
  expect(card.slice(0, card.indexOf('>'))).toContain('hidden=""')
  expect(card).toContain('Working toward goal: ship the search box')
  expect(card).toContain('Pause goal')
  expect(card).toContain('Details')
})

it('keeps every chip that fits and leaves room for the "+N" chip once one does not', () => {
  expect(chipsThatFit([80, 80, 80], 244)).toBe(3)
  // 80 + 2 + 80 needs 162; with 56 + 2 kept for "+N", only the first fits in 200.
  expect(chipsThatFit([80, 80, 80], 200)).toBe(1)
  expect(chipsThatFit([80, 80, 80, 80], 230)).toBe(2)
  expect(chipsThatFit([], 100)).toBe(0)
})
