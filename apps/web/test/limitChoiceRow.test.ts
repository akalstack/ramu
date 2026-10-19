import { createContext, createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  dropdown: null as null | {
    value: string
    options: { value: string; label: string; disabled?: boolean }[]
    disabled?: boolean
    onChange: (value: string) => void
  },
}))
vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)),
}))
vi.mock('../src/Menu', () => ({
  Dropdown: (props: NonNullable<typeof state.dropdown>) => {
    state.dropdown = props
    return createElement('select')
  },
}))
vi.mock('@/components/settings-row', () => ({
  SettingsRow: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SettingsLabel: ({ title, help }: { title: string; help?: string }) => createElement('span', null, title, help),
}))
vi.mock('../src/settings/SettingsScope', async () => ({ SettingsScopeContext: createContext(null) }))

const { LimitChoiceRow, LIMIT_CHOICE_PATHS, withLimitChoice } = await import('../src/settings/LimitChoiceRow')
const { SettingsScopeContext } = await import('../src/settings/SettingsScope')

type Field = { mixed: boolean; disabled: boolean }
const prefs = (defaultAutoFallback: boolean, autoResume: boolean): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  defaultAutoFallback,
  fallback: { ...DEFAULT_APP_PREFERENCES.fallback, autoResume },
})

function render(draft: AppPreferences, fields: Record<string, Partial<Field>> = {}, onChange = vi.fn()) {
  const mark = vi.fn()
  const scope = {
    field: (path: string) => ({ mixed: false, disabled: false, ...fields[path] }),
    mark,
  }
  const html = renderToStaticMarkup(
    createElement(
      SettingsScopeContext.Provider,
      { value: scope as never },
      createElement(LimitChoiceRow, { draft, onChange, busy: false }),
    ),
  )
  return { html, mark, onChange }
}
beforeEach(() => {
  state.dropdown = null
})

it('shows the stored pair as one of the three options', () => {
  for (const [fallback, resume, value] of [
    [true, true, 'switch'],
    [false, true, 'wait'],
    [false, false, 'stop'],
  ] as const) {
    render(prefs(fallback, resume))
    expect(state.dropdown?.value).toBe(value)
    expect(state.dropdown?.options.map((option) => option.value)).toEqual(['switch', 'wait', 'stop'])
  }
})

it('offers the hidden fourth option only while it is stored, so nothing is silently rewritten', () => {
  render(prefs(true, false))
  expect(state.dropdown?.value).toBe('switch-then-stop')
  expect(state.dropdown?.options.map((option) => option.label)).toContain('Switch, then stop if none has room')
})

it('writes both stored values for each pick, and marks both paths for every host', () => {
  const { mark, onChange } = render(prefs(true, true))
  state.dropdown!.onChange('stop')
  expect(onChange).toHaveBeenCalledOnce()
  const next = onChange.mock.calls[0]![0] as AppPreferences
  expect(next.defaultAutoFallback).toBe(false)
  expect(next.fallback.autoResume).toBe(false)
  expect(next.fallback.switchAt).toBe(DEFAULT_APP_PREFERENCES.fallback.switchAt)
  expect(mark.mock.calls.map(([path]) => path)).toEqual([...LIMIT_CHOICE_PATHS])
  expect(withLimitChoice(prefs(false, false), 'switch')).toMatchObject({
    defaultAutoFallback: true,
    fallback: { autoResume: true },
  })
})

it('is Mixed when either stored value differs between hosts, and disables the dependants unaffected', () => {
  for (const path of LIMIT_CHOICE_PATHS) {
    const { html } = render(prefs(true, true), { [path]: { mixed: true } })
    expect(state.dropdown?.value).toBe('__ramu_mixed__')
    expect(state.dropdown?.options[0]).toMatchObject({ label: 'Mixed', disabled: true })
    expect(html).toContain('Use this value for all')
  }
  const { html } = render(prefs(true, true))
  expect(html).not.toContain('Mixed')
})

it('is disabled with a notice when a host does not offer the setting', () => {
  const { html } = render(prefs(true, true), { 'fallback.autoResume': { disabled: true } })
  expect(state.dropdown?.disabled).toBe(true)
  expect(html).toContain('Not supported by every selected host.')
})
