import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { KeepAwakeSettings } from '../src/settings/KeepAwakeSettings'
import { ToggleRow } from '../src/settings/ToggleRow'
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsFieldNotice: () => null,
  SettingsField: ({ children }: { children: ReactNode }) => children,
  SettingsScopeContext: (await import('react')).createContext(null),
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))

it('edits the shared keep-awake preference and preserves its power policy', () => {
  const draft = { ...DEFAULT_APP_PREFERENCES, keepAwake: false, keepAwakeWhen: 'plugged-in' as const }
  const onChange = vi.fn()
  const children = KeepAwakeSettings({ draft, onChange, busy: false }).props.children
  const toggle = children[0]
  const switchControl = ToggleRow(toggle.props).props.children[1]
  switchControl.props.onCheckedChange(true)
  expect(onChange).toHaveBeenCalledWith({ ...draft, keepAwake: true })
  const off = renderToStaticMarkup(createElement(KeepAwakeSettings, { draft, onChange, busy: false }))
  expect(off).toContain('aria-label="Keep host awake"')
  expect(off).not.toContain('When to keep awake')
  const on = renderToStaticMarkup(
    createElement(KeepAwakeSettings, { draft: { ...draft, keepAwake: true }, onChange, busy: false }),
  )
  expect(on).toContain('When to keep awake')
  expect(on).toContain('Plugged in only (recommended)')
})
