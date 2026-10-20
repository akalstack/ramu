import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { recommendedSets } from '@ramu/shared/providers/modelDefaults'
import { translate } from '@ramu/shared/i18n'
import { ModelSetsEditor } from '../src/settings/ModelSetsEditor'

const controls = vi.hoisted(
  () =>
    new Map<
      string,
      { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }
    >(),
)
vi.mock('../src/i18n', () => ({ t: (value: string) => value }))
vi.mock('../src/settings/SettingsScope', () => ({ SettingsField: ({ children }: { children: ReactNode }) => children }))
vi.mock('../src/settings/ModelStepCard', () => ({ ModelStepCard: () => null }))
vi.mock('../src/models/ModelSets', () => ({ modelStepName: (step: { name: string }) => step.name }))
vi.mock('../src/Menu', () => ({
  Dropdown: (props: {
    label: string
    options: { value: string; label: string }[]
    value: string
    onChange: (value: string) => void
  }) => {
    controls.set(props.label, props)
    return createElement('span', null, props.label)
  },
}))

it('offers both selection flows and changes only the presentation preference', () => {
  const draft = recommendedSets([])
  let saved = draft
  const html = renderToStaticMarkup(
    createElement(ModelSetsEditor, {
      draft,
      setDraft: (value) => {
        saved = typeof value === 'function' ? value(saved) : value
      },
      selected: draft.defaultSetId,
      setSelected() {},
      catalogs: [],
      busy: false,
      onRestore() {},
      onRefresh() {},
    }),
  )
  expect(html).toContain('Switching keeps your current selection and draft.')
  const control = controls.get('Model selection')!
  expect(control.options).toEqual([
    { value: 'model', label: 'Steps' },
    { value: 'effort', label: 'Model then effort' },
  ])
  control.onChange('effort')
  expect(saved.defaultBarMode).toBe('effort')
  expect(saved.sets).toBe(draft.sets)
  expect(saved.defaultStepId).toBe(draft.defaultStepId)
  for (const text of ['Model selection', 'Steps', 'Model then effort']) expect(translate('id', text)).not.toBe(text)
})
