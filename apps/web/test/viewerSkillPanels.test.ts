import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as (() => void)[],
  viewer: false,
  host: 'a',
  invoke: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = typeof value === 'function' ? value() : value
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next
      },
    ]
  },
  useContext: () => ({ primaryId: state.host, targets: [{ viewOnly: state.viewer }] }),
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      state.effects.push(() => {
        previous?.cleanup?.()
        state.slots[index] = { deps, cleanup: run() }
      })
  },
  useCallback: (run: unknown, deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) state.slots[index] = { deps, value: run }
    return state.slots[index].value
  },
}))
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsScopeContext: (await import('react')).createContext(null),
  useSettingsInvoke: () => state.invoke,
}))
vi.mock('../src/settings/cards', () => ({
  SettingsCard: 'SettingsCard',
  SettingsCardList: 'SettingsCardList',
  usePaged: (shown: unknown[]) => ({ shown, more: null }),
}))
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => ({ projects: [] }) }))
vi.mock('../src/Menu', () => ({ Dialog: 'Dialog', Dropdown: 'Dropdown' }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/ui/input', () => ({ Input: 'Input' }))
vi.mock('@/components/ui/textarea', () => ({ Textarea: 'Textarea' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'Checkbox' }))
vi.mock('@/components/ui/badge', () => ({ Badge: 'Badge' }))
import { InstalledSkills } from '../src/settings/InstalledSkills'
import { PermissionRules } from '../src/settings/PermissionRules'
type Node = { type?: unknown; props: Record<string, any> }
const nodes = (value: unknown): Node[] =>
  !value || typeof value !== 'object'
    ? []
    : [
        value as Node,
        ...[(value as Node).props?.children, (value as Node).props?.actions].flat(Infinity).flatMap(nodes),
      ]
const RenderSkills = () => {
  state.cursor = 0
  return InstalledSkills()
}
const RenderPermissions = () => {
  state.cursor = 0
  return PermissionRules({ disabled: false })
}
const flush = async () => {
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
beforeEach(() => {
  state.slots = []
  state.effects = []
  state.viewer = false
  state.host = 'a'
  state.invoke.mockReset().mockImplementation(async (method) => {
    if (method === 'learning.get')
      return {
        skills: [
          {
            id: 'skill',
            revision: 1,
            name: 'My skill',
            description: 'When useful',
            content: 'Original',
            projectId: null,
            changedBy: 'user',
            status: 'active',
          },
        ],
      }
    if (method === 'skills.availability') return { available: true }
    if (method === 'projects.list') return []
    if (method === 'settings.permissions.list')
      return [{ id: 'permission', provider: 'codex', scope: 'user', label: 'Allowed command' }]
    throw new Error(`Unexpected ${method}`)
  })
})
it('keeps an open skill draft read-only and refuses an old save callback after viewer access', async () => {
  RenderSkills()
  await flush()
  const edit = nodes(RenderSkills()).find((node) => node.type === 'Button' && node.props.children === 'Edit')!
  edit.props.onClick()
  let tree = nodes(RenderSkills())
  tree
    .find((node) => node.props?.['aria-label'] === 'Instructions')!
    .props.onChange({ target: { value: 'Kept instructions' } })
  const retained = nodes(RenderSkills()).find((node) => node.type === 'Dialog' && node.props.title === 'Edit skill')!
    .props.onConfirm
  state.viewer = true
  tree = nodes(RenderSkills())
  await flush()
  expect(tree.find((node) => node.props?.['aria-label'] === 'Instructions')!.props.value).toBe('Kept instructions')
  expect(tree.find((node) => node.props?.['aria-label'] === 'Instructions')!.props.readOnly).toBe(true)
  expect(tree.find((node) => node.type === 'Dialog')!.props.confirmDisabled).toBe(true)
  state.invoke.mockClear()
  retained()
  await flush()
  expect(state.invoke).not.toHaveBeenCalled()
})
it('preserves readable approval records but blocks retained removal after a role or host change', async () => {
  RenderPermissions()
  await flush()
  const before = nodes(RenderPermissions())
  const remove = before.find((node) => node.type === 'Button' && node.props.children === 'Remove displayed approvals')!
  state.viewer = true
  const viewer = nodes(RenderPermissions())
  await flush()
  expect(viewer.some((node) => node.props?.title?.props?.children === 'Allowed command')).toBe(true)
  expect(
    viewer.find((node) => node.type === 'Button' && node.props.children === 'Remove displayed approvals')!.props
      .disabled,
  ).toBe(true)
  state.invoke.mockClear()
  remove.props.onClick()
  await flush()
  expect(state.invoke).not.toHaveBeenCalled()
  state.viewer = false
  state.host = 'b'
  RenderPermissions()
  remove.props.onClick()
  expect(state.invoke).not.toHaveBeenCalled()
})
