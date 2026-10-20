import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ComposerStack } from '../src/composer/ComposerStack'
import { ComposerTray } from '../src/composer/ComposerTray'
import { ComposerTraySection } from '../src/composer/ComposerTraySection'

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
