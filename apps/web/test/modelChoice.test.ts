import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { ModelChoiceValue } from '../src/settings/ModelChoice'

type Option = { value: string; label: unknown }
const state = vi.hoisted(() => ({
  combobox: undefined as { value: string; options: Option[]; onChange: (value: string) => void } | undefined,
  dropdowns: [] as { label: string; value: string; options: Option[]; onChange: (value: string) => void }[],
  logins: null as null | { order: string[]; current: string; name: (id: string) => string },
}))
vi.mock('../src/i18n', () => ({ t: (value: string) => value, useLanguage() {} }))
vi.mock('@/components/combobox', () => ({
  Combobox: (props: NonNullable<typeof state.combobox>) => {
    state.combobox = props
    return null
  },
}))
vi.mock('../src/Menu', () => ({
  Dropdown: (props: (typeof state.dropdowns)[number]) => {
    state.dropdowns.push(props)
    return null
  },
}))
vi.mock('../src/models/ModelSets', () => ({
  effortDisplayName: (effort: string) => effort,
  useModelSets: () => ({
    catalogs: [
      {
        models: [
          { provider: 'claude-code', id: 'opus', name: 'Opus', efforts: ['low', 'high'], defaultEffort: 'high' },
          { provider: 'codex', id: 'gpt', name: 'GPT', efforts: [], defaultEffort: null },
        ],
      },
    ],
  }),
}))
vi.mock('../src/models/modelOptions', () => ({
  modelOption: (model: { name: string }, value: string) => ({ value, label: model.name }),
}))
vi.mock('../src/models/AccountPicker', () => ({ useLoginChoices: () => state.logins }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { visibleModels: {} } }) }))
const { ModelChoice } = await import('../src/settings/ModelChoice')

const render = (value: ModelChoiceValue) => {
  state.combobox = undefined
  state.dropdowns = []
  const onChange = vi.fn()
  renderToStaticMarkup(createElement(ModelChoice, { label: 'Writing model', value, onChange }))
  return onChange
}

it('offers the thread’s model and the default model before every visible model', () => {
  const onChange = render(null)
  expect(state.combobox!.value).toBe('thread')
  expect(state.combobox!.options.map((option) => option.label)).toEqual([
    'Same as thread',
    'Default model',
    'Opus',
    'GPT',
  ])
  state.combobox!.onChange('default')
  expect(onChange).toHaveBeenLastCalledWith({ use: 'default' })
  state.combobox!.onChange('claude-code\nopus')
  expect(onChange).toHaveBeenLastCalledWith({ provider: 'claude-code', model: 'opus', effort: 'high' })
  render({ use: 'default' })
  expect(state.combobox!.value).toBe('default')
})

it('chooses the login a chosen model runs on when its provider has several', () => {
  state.logins = { order: ['default', 'work'], current: 'default', name: (id) => id }
  const chosen = { provider: 'claude-code' as const, model: 'opus', effort: 'high' as const }
  const onChange = render(chosen)
  const account = state.dropdowns.find((dropdown) => dropdown.label === 'Account')!
  expect(account.options.map((option) => option.value)).toEqual(['default', 'work'])
  account.onChange('work')
  expect(onChange).toHaveBeenLastCalledWith({ ...chosen, accountId: 'work' })
  // The thread's own model brings the thread's own login, so there is no login to choose.
  render(null)
  expect(state.dropdowns.find((dropdown) => dropdown.label === 'Account')).toBeUndefined()
})
