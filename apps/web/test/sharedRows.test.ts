import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { RowButton } from '../src/components/row-button'
import { InlineAction, InlineLink } from '../src/components/inline-action'
import { SettingsFieldContext } from '../src/settings/settingsField'
import { HoverCard, HoverCardTrigger } from '../src/components/ui/hover-card'

it('keeps selection state, sensor refs and keyboard/click handlers on one native row button', () => {
  const ref = vi.fn(),
    onClick = vi.fn(),
    onKeyDown = vi.fn()
  const row = RowButton({ ref, onClick, onKeyDown, 'aria-pressed': true, children: 'Laptop' })
  expect(row.props.ref).toBe(ref)
  expect(row.props.onClick).toBe(onClick)
  expect(row.props.onKeyDown).toBe(onKeyDown)
  const html = renderToStaticMarkup(row)
  expect(html).toContain('type="button"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('Laptop')
})
it('composes with hover-card triggers while keeping an offline row disabled and focusable for cached details', () => {
  const html = renderToStaticMarkup(
    createElement(
      HoverCard,
      null,
      createElement(HoverCardTrigger, {
        render: createElement(RowButton, { disabled: true, focusableWhenDisabled: true }),
        children: 'Cached conversation',
      }),
    ),
  )
  const buttons = html.match(/<button\b[^>]*>/g) ?? []
  expect(buttons).toHaveLength(1)
  expect(buttons[0]).toContain('aria-disabled="true"')
  expect(buttons[0]).toContain('tabindex="0"')
  expect(buttons[0]).not.toMatch(/\sdisabled=""/)
})
it('retains native disabled semantics for stale activity and busy clone rows', () => {
  const html = renderToStaticMarkup(createElement(RowButton, { disabled: true, stacked: true, children: 'Output' }))
  expect(html).toMatch(/\sdisabled=""/)
  expect(html).toContain('Output')
})
it('disables host inline mutations without turning a device-local external destination into a disabled button', () => {
  const html = renderToStaticMarkup(
    createElement(SettingsFieldContext.Provider, {
      value: { path: 'setup', disabled: true, mixed: false, mark() {} },
      children: [
        createElement(InlineAction, { key: 'action', children: 'Share everywhere' }),
        createElement(InlineLink, { key: 'link', href: 'https://example.com/settings', children: 'Manage account' }),
      ],
    }),
  )
  expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>/)
  expect(html).toMatch(/<a[^>]*href="https:\/\/example.com\/settings"[^>]*>/)
  expect(html.match(/<a[^>]*>/)?.[0]).not.toMatch(/\s(?:disabled|aria-disabled)=/)
})
