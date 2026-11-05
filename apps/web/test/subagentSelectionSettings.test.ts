import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_SUBAGENT_PREFERENCES } from '@ramu/shared/types'

const picks = vi.hoisted(
  () =>
    new Map<
      string,
      {
        value: string
        disabled: boolean
        onChange: (value: string) => void
        options: { value: string; label: string }[]
      }
    >(),
)
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key),
}))
vi.mock('../src/components/settings-row', () => ({
  SettingsRow: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SettingsTitle: ({ children }: { children: ReactNode }) => createElement('strong', null, children),
}))
vi.mock('../src/Menu', () => ({
  Dropdown: (props: {
    label: string
    value: string
    disabled: boolean
    onChange: (value: string) => void
    options: { value: string; label: string }[]
  }) => {
    picks.set(props.label, props)
    return createElement('span', null, props.label)
  },
}))
vi.mock('../src/models/ModelSets', () => ({
  modelDisplayName: (name: string) => name,
  effortDisplayName: (effort: string) => effort,
  useModelSets: () => ({
    catalogs: [
      { provider: 'codex', models: [{ provider: 'codex', id: 'test', name: 'Test model', efforts: ['low', 'high'] }] },
    ],
  }),
}))
import { SubagentSelectionSettings } from '../src/settings/SubagentSelectionSettings'

it('offers automatic modes and saves provider-qualified model caps independently', () => {
  picks.clear()
  const onChange = vi.fn()
  const html = renderToStaticMarkup(
    createElement(SubagentSelectionSettings, { value: DEFAULT_SUBAGENT_PREFERENCES, onChange, busy: false }),
  )
  expect(html).toContain('Per-model effort caps')
  const auto = picks.get('Automatic selection')!
  expect(auto.value).toBe('off')
  expect(auto.options.map((o) => o.value)).toEqual(['off', 'model-and-effort', 'effort-only'])
  auto.onChange('effort-only')
  expect(onChange).toHaveBeenLastCalledWith({ autoSelect: 'effort-only' })
  picks.get('Maximum sub-agent effort')!.onChange('medium')
  expect(onChange).toHaveBeenLastCalledWith({ maxEffort: 'medium' })
  const model = picks.get('Maximum effort for Test model')!
  expect(model.options.map((o) => o.value)).toEqual(['', 'low', 'high'])
  model.onChange('low')
  expect(onChange).toHaveBeenLastCalledWith({ modelMaxEffort: { 'codex:test': 'low' } })
  model.onChange('')
  expect(onChange).toHaveBeenLastCalledWith({ modelMaxEffort: {} })
})
