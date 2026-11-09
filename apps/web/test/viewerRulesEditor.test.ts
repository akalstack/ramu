import { beforeEach, expect, it, vi } from 'vitest'
import type { Rule } from '@ramu/shared/types'
const state = vi.hoisted(() => ({
  viewer: false,
  host: 'host',
  cursor: 0,
  slots: [] as unknown[],
  mode: 'list',
  invoke: vi.fn(),
  rule: {
    id: 'rule',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    name: 'Rule',
    body: 'Original instructions',
    providers: [],
    projectId: null,
    enabled: true,
    activation: 'always',
    paths: [],
  } as Rule,
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = state.mode === 'list' && index === 1 ? state.rule : value
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next
      },
    ]
  },
  useContext: () => ({ primaryId: state.host, ready: true, targets: [{ viewOnly: state.viewer }] }),
  useEffect() {},
  useId: () => 'field',
  useMemo: (run: () => unknown) => run(),
  useCallback: (run: unknown) => run,
}))
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsScopeContext: (await import('react')).createContext(null),
  useSettingsInvoke: () => state.invoke,
  useSettingsEvents: () => () => () => {},
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'rules' ? [state.rule] : [],
    refetch: vi.fn(),
  }),
}))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
vi.mock('../src/Menu', () => ({ Dialog: 'Dialog', Dropdown: 'Dropdown', timeAgo: () => '' }))
vi.mock('../src/settings/NativeInstructions', () => ({ NativeInstructions: () => null }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/desktop-input', () => ({ Input: 'Input' }))
vi.mock('@/components/ui/textarea', () => ({ Textarea: 'Textarea' }))
vi.mock('@/components/ui/switch', () => ({ Switch: 'Switch' }))
import { RulesSettings } from '../src/settings/RulesSettings'
type Node = { type?: unknown; props: Record<string, any> }
const nodes = (value: unknown): Node[] =>
  !value || typeof value !== 'object'
    ? []
    : [
        value as Node,
        ...[(value as Node).props?.children, (value as Node).props?.actions].flat(Infinity).flatMap(nodes),
      ]
const RenderRules = () => {
  state.cursor = 0
  return RulesSettings()
}
beforeEach(() => {
  state.slots = []
  state.cursor = 0
  state.viewer = false
  state.host = 'host'
  state.mode = 'list'
  state.invoke.mockReset()
})
it('blocks retained rule toggles and deletion prompts after a role change', () => {
  const before = nodes(RenderRules())
  const toggle = before.find((node) => node.type === 'Switch')!
  const remove = before.find((node) => node.type === 'Button' && node.props.children === 'Delete')!
  state.viewer = true
  const viewer = nodes(RenderRules())
  expect(viewer.find((node) => node.type === 'Switch')!.props.disabled).toBe(true)
  toggle.props.onCheckedChange(false)
  remove.props.onClick()
  expect(state.invoke).not.toHaveBeenCalled()
})
it('keeps an open editor draft and refuses a retained form submit after viewer access', async () => {
  const editor = nodes(RenderRules()).find(
    (node) => typeof node.type === 'function' && node.type.name === 'RuleEditor',
  )!
  state.slots = []
  state.mode = 'editor'
  const RenderEditor = (readOnly: boolean) => {
    state.cursor = 0
    return (editor.type as (props: Record<string, unknown>) => unknown)({ ...editor.props, readOnly })
  }
  nodes(RenderEditor(false))
    .find((node) => node.type === 'Textarea')!
    .props.onChange({ target: { value: 'Kept draft instructions' } })
  const before = nodes(RenderEditor(false))
  const submit = before.find((node) => node.type === 'form')!.props.onSubmit
  const viewer = nodes(RenderEditor(true))
  expect(viewer.find((node) => node.type === 'Textarea')!.props.value).toBe('Kept draft instructions')
  expect(viewer.find((node) => node.type === 'fieldset')!.props.disabled).toBe(true)
  expect(viewer.find((node) => node.type === 'Dialog')!.props.confirmDisabled).toBe(true)
  submit({ preventDefault() {} })
  await Promise.resolve()
  expect(state.invoke).not.toHaveBeenCalled()
})

it('refuses an open editor callback when its parent has switched hosts', async () => {
  const parent = RenderRules()
  const parentSlots = state.slots
  const editor = nodes(parent).find((node) => typeof node.type === 'function' && node.type.name === 'RuleEditor')!
  state.slots = []
  state.mode = 'editor'
  state.cursor = 0
  const draft = (editor.type as (props: Record<string, unknown>) => unknown)(editor.props)
  const submit = nodes(draft).find((node) => node.type === 'form')!.props.onSubmit
  state.slots = parentSlots
  state.mode = 'list'
  state.host = 'other'
  RenderRules()
  submit({ preventDefault() {} })
  await Promise.resolve()
  expect(state.invoke).not.toHaveBeenCalled()
})
