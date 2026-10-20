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

it('shows automatic steps without editing controls, while custom sets stay editable', () => {
  const draft = recommendedSets([])
  draft.sets.push({ id: 'custom', name: 'My models', steps: [{ ...draft.sets[0]!.steps[0]!, id: 'custom-step' }] })
  const render = (selected: string) =>
    renderToStaticMarkup(
      createElement(ModelSetsEditor, {
        draft,
        selected,
        setDraft() {},
        setSelected() {},
        catalogs: [],
        busy: false,
        onRestore() {},
        onRefresh() {},
      }),
    )
  const automatic = render('recommended')
  expect(automatic).toContain('Default updates automatically from active providers.')
  expect(automatic).toContain('aria-label="Automatic model steps"')
  expect(automatic).toContain('GPT-6.1 Sol Low')
  expect(automatic).not.toContain('Set name')
  expect(automatic).not.toContain('Add step')
  expect(automatic).toMatch(/<button[^>]*aria-label="Remove model set"[^>]*disabled/)
  const custom = render('custom')
  expect(custom).toContain('Set name')
  expect(custom).toContain('Add step')
  expect(custom).not.toContain('Automatic model steps')
  expect(translate('id', 'Automatic model steps')).not.toBe('Automatic model steps')
})
