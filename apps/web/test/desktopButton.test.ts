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

const ghostClasses = (className?: string) =>
  renderToStaticMarkup(createElement(Button, { variant: 'ghost', className }, 'Clear'))
    .match(/class="([^"]*)"/)![1]!
    .split(' ')

it('fills every ghost button on hover, in dark mode too', () => {
  for (const className of [undefined, 'hover:bg-hover text-muted-foreground']) {
    const list = ghostClasses(className)
    expect(list).toContain('hover:bg-fill-hover')
    expect(list).toContain('dark:hover:bg-fill-hover')
    expect(list).not.toContain('dark:hover:bg-muted/50')
    expect(list).not.toContain('hover:bg-hover')
  }
})

it('leaves a button that opts out of the hover fill alone', () => {
  const list = ghostClasses('hover:bg-transparent')
  expect(list).toContain('dark:hover:bg-transparent')
  expect(list).not.toContain('hover:bg-fill-hover')
})

it('lets a toggle whose open state is its resting state keep no fill while expanded', () => {
  const toggle = renderToStaticMarkup(
    createElement(Button, { variant: 'ghost', 'aria-expanded': true, className: 'aria-expanded:bg-transparent' }),
  )
  expect(toggle).toContain('aria-expanded:bg-transparent')
  expect(toggle).not.toContain('aria-expanded:bg-fill-hover')
  const menu = renderToStaticMarkup(createElement(Button, { variant: 'ghost', 'aria-expanded': true }))
  expect(menu).toContain('aria-expanded:bg-fill-hover')
})
