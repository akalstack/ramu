import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { Button } from '../src/components/desktop-button'
import { SettingsFieldContext } from '../src/settings/settingsField'

it('keeps settings actions disabled when their enclosing field is unavailable', () => {
  const html = renderToStaticMarkup(
    createElement(
      SettingsFieldContext.Provider,
      { value: { path: 'example', mixed: false, disabled: true, mark: vi.fn() } },
      createElement(Button, { variant: 'link', disabled: false }, 'Use this value for all'),
    ),
  )
  expect(html).toContain('disabled=""')
  expect(html).toContain('Use this value for all')
})

it('preserves drag handle accessibility attributes and an explicit disabled state', () => {
  const html = renderToStaticMarkup(
    createElement(Button, {
      variant: 'ghost',
      size: 'icon-xs',
      'aria-label': 'Drag step 2 to reorder',
      'aria-describedby': 'drag-instructions',
      disabled: true,
    }),
  )
  expect(html).toContain('aria-label="Drag step 2 to reorder"')
  expect(html).toContain('aria-describedby="drag-instructions"')
  expect(html).toContain('disabled=""')
})

it('keeps the device font-size token alongside a text color instead of merging it away', () => {
  const html = renderToStaticMarkup(createElement(Button, { className: 'text-caption text-muted-foreground' }, 'Copy'))
  expect(html).toContain('text-[length:var(--font-caption)]')
  expect(html).toContain('text-muted-foreground')
  expect(html).not.toMatch(/\btext-(?:sm|body)\b/)
  const inherited = renderToStaticMarkup(createElement(Button, { className: 'text-muted-foreground' }, 'Save'))
  expect(inherited).toContain('text-[length:var(--font-body)]')
})
