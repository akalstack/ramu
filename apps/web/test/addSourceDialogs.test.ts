import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

// Hooks keep their values across calls of the section, so a test can act and render again as React would.
const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  values: [] as unknown[],
  index: 0,
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] =
          typeof value === 'function' ? (value as (old: unknown) => unknown)(state.values[index]) : value
      },
    ]
  },
  useEffect() {},
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  formatLocale: () => 'en',
  t: (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: state.invoke, on: () => () => {} }) }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: () => ({}) }))
vi.mock('../src/Menu', () => ({ Dialog: 'dialog', Dropdown: 'dropdown', Menu: 'menu' }))
vi.mock('../src/settings/InstalledSkills', () => ({ InstalledSkills: 'installed-skills' }))
vi.mock('../src/settings/Plugins', () => ({ Credential: 'credential' }))
vi.mock('../src/customize/SkillFiles', () => ({ SkillFiles: 'skill-files' }))

import { SkillsSection } from '../src/customize/SkillsSection'
import { PluginsSection } from '../src/customize/PluginsSection'

type Props = Record<string, unknown> & { children?: ReactNode }
function* walk(node: ReactNode): Generator<ReactElement<Props>> {
  if (Array.isArray(node)) for (const child of node) yield* walk(child)
  else if (isValidElement<Props>(node)) {
    yield node
    for (const value of Object.values(node.props))
      if (value && typeof value === 'object') yield* walk(value as ReactNode)
  }
}
const find = (tree: ReactNode, test: (element: ReactElement<Props>) => boolean) => [...walk(tree)].find(test)
const named = (name: string) => (element: ReactElement<Props>) =>
  typeof element.type === 'function' && element.type.name === name
const menuItem = (tree: ReactNode, key: string) =>
  [...walk(tree)]
    .flatMap((element) => (Array.isArray(element.props.items) ? element.props.items : []))
    .find((item: { key?: string }) => item.key === key) as { onSelect(): void }

beforeEach(() => {
  state.values = []
  state.invoke.mockReset()
})

function render<P extends object>(component: (props: P) => ReactNode, props: P) {
  state.index = 0
  return component(props)
}

it.each([
  {
    name: 'a skill source',
    section: () => render(SkillsSection, { onOpenPlugins() {} }),
    item: 'source',
    dialog: 'AddSkillSource',
    stage: 'skills.stage',
    submit: (onSubmit: (...args: string[]) => void) => onSubmit('acme/skils', ''),
  },
  {
    name: 'a plugin address',
    section: () => render(PluginsSection, {} as Parameters<typeof PluginsSection>[0]),
    item: 'source',
    dialog: 'AddSource',
    stage: 'plugins.stage',
    submit: (onSubmit: (...args: string[]) => void) => onSubmit('github.com/acme/plgin'),
  },
])(
  'a failed install from $name keeps the dialog open with the reason',
  async ({ section, item, dialog, stage, submit }) => {
    state.invoke.mockImplementation(async (method: string) => {
      if (method === stage) throw new Error('Repository not found')
      if (method === 'learning.get') return { skills: [] }
      return []
    })
    menuItem(section(), item).onSelect()
    const open = find(section(), named(dialog))
    expect(open).toBeDefined()
    submit(open!.props.onSubmit as (...args: string[]) => void)
    await vi.waitFor(() => expect(find(section(), named(dialog))?.props.error).toBe('Repository not found'))

    // Cancelling closes it and clears the reason, so the page does not keep a stale error.
    ;(find(section(), named(dialog))!.props.onCancel as () => void)()
    const after = section()
    expect(find(after, named(dialog))).toBeUndefined()
  },
)

it('a plugin address that stages closes the dialog for the review', async () => {
  state.invoke.mockImplementation(async (method: string) =>
    method === 'plugins.stage' ? { contents: { name: 'render' } } : [],
  )
  const section = () => render(PluginsSection, {} as Parameters<typeof PluginsSection>[0])
  menuItem(section(), 'source').onSelect()
  ;(find(section(), named('AddSource'))!.props.onSubmit as (value: string) => void)('github.com/acme/render')
  await vi.waitFor(() => expect(find(section(), named('AddSource'))).toBeUndefined())
})
