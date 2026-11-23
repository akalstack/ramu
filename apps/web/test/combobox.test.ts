import { expect, it } from 'vitest'
import { filterComboboxOptions, type ComboboxOption } from '../src/components/combobox-options'

const options: ComboboxOption[] = [
  { value: '', label: 'Same as thread' },
  { value: 'claude:opus', label: 'Opus 4.5', group: 'Claude', keywords: 'claude-opus-4-5' },
  {
    value: 'oc:nex',
    label: 'Nex N2.5 Pro',
    group: 'OpenRouter via OpenCode',
    keywords: 'openrouter/nex-agi/nex-n2.5-pro',
  },
  { value: 'oc:nemo', label: 'Nemotron 3 Ultra (free)', group: 'OpenRouter via OpenCode' },
  { value: 'oc:pro', label: 'Pro Max', group: 'OpenRouter via OpenCode' },
]
const values = (result: ReturnType<typeof filterComboboxOptions>) =>
  result.groups.map((group) => [group.name, group.options.map((option) => option.value)])

it('lists every option under its group, ungrouped ones first, when nothing is typed', () => {
  expect(values(filterComboboxOptions(options, ''))).toEqual([
    [null, ['']],
    ['Claude', ['claude:opus']],
    ['OpenRouter via OpenCode', ['oc:nex', 'oc:nemo', 'oc:pro']],
  ])
})

it('matches every typed word in any order across label, group and keywords, closest labels first', () => {
  expect(values(filterComboboxOptions(options, 'pro nex'))).toEqual([['OpenRouter via OpenCode', ['oc:nex']]])
  expect(values(filterComboboxOptions(options, 'openrouter ultra'))).toEqual([['OpenRouter via OpenCode', ['oc:nemo']]])
  expect(values(filterComboboxOptions(options, 'opus-4-5'))).toEqual([['Claude', ['claude:opus']]])
  expect(values(filterComboboxOptions(options, 'pro'))).toEqual([['OpenRouter via OpenCode', ['oc:pro', 'oc:nex']]])
  expect(filterComboboxOptions(options, 'gemini')).toEqual({ groups: [], hidden: 0 })
})

it('draws at most the limit, keeps the chosen option and counts what a narrower search would show', () => {
  const many = Array.from({ length: 500 }, (_, index) => ({
    value: `m${index}`,
    label: `Model ${index}`,
    group: 'Big',
  }))
  const capped = filterComboboxOptions(many, '', { limit: 50, keep: 'm420' })
  expect(capped.groups[0]!.options).toHaveLength(51)
  expect(capped.groups[0]!.options.at(-1)!.value).toBe('m420')
  expect(capped.hidden).toBe(449)
  expect(filterComboboxOptions(many, 'model 42', { limit: 50 }).hidden).toBe(0)
})
