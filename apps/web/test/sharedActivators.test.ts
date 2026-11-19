import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DragHandle } from '../src/components/drag-handle'
import { SidebarDisclosureButton } from '../src/components/sidebar-disclosure-button'
import { SettingsFieldContext } from '../src/settings/settingsField'

it('preserves pointer/keyboard sensors, activator refs and drag instructions', () => {
  const ref = vi.fn(),
    onPointerDown = vi.fn(),
    onKeyDown = vi.fn()
  const handle = DragHandle({
    ref,
    onPointerDown,
    onKeyDown,
    'aria-label': 'Reorder favorite',
    'aria-describedby': 'drag-instructions',
    tabIndex: 0,
  })
  expect(handle.props.ref).toBe(ref)
  expect(handle.props.onPointerDown).toBe(onPointerDown)
  expect(handle.props.onKeyDown).toBe(onKeyDown)
  const html = renderToStaticMarkup(handle)
  expect(html).toContain('type="button"')
  expect(html).toContain('aria-label="Reorder favorite"')
  expect(html).toContain('aria-describedby="drag-instructions"')
  expect(html).toContain('tabindex="0"')
  expect(html).not.toMatch(/\sdisabled=""/)
})
it('blocks busy and unavailable-settings drag handles with native disabled state', () => {
  const busy = renderToStaticMarkup(createElement(DragHandle, { 'aria-label': 'Reorder', disabled: true }))
  expect(busy).toMatch(/\sdisabled=""/)
  const unavailable = renderToStaticMarkup(
    createElement(SettingsFieldContext.Provider, {
      value: { path: 'model.steps', disabled: true, mixed: false, mark() {} },
      children: createElement(DragHandle, { 'aria-label': 'Reorder', disabled: false }),
    }),
  )
  expect(unavailable).toMatch(/\sdisabled=""/)
})
it('preserves controlled sidebar disclosure state and its callback through the shared tree button', () => {
  const ref = vi.fn(),
    onClick = vi.fn()
  const button = SidebarDisclosureButton({
    ref,
    'aria-expanded': false,
    'aria-controls': 'host-threads',
    onClick,
    children: 'Laptop',
  })
  expect(button.props.ref).toBe(ref)
  expect(button.props.onClick).toBe(onClick)
  const html = renderToStaticMarkup(button)
  expect(html).toContain('type="button"')
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-controls="host-threads"')
  expect(html).toContain('Laptop')
})

it('can retain keyboard focus while saving without offering an active reorder control', () => {
  const html = renderToStaticMarkup(
    createElement(DragHandle, { 'aria-label': 'Reorder favorite', disabled: true, focusableWhenDisabled: true }),
  )
  expect(html).toContain('aria-disabled="true"')
  expect(html).toContain('tabindex="0"')
  expect(html).not.toMatch(/\sdisabled=""/)
})
