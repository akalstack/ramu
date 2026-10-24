import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as (() => void)[],
  viewer: false,
  allowed: true,
  invoke: vi.fn(),
  host: { id: 'host' },
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = value
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next
      },
    ]
  },
  useCallback: (run: unknown, deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) state.slots[index] = { deps, value: run }
    return state.slots[index].value
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      state.effects.push(() => {
        previous?.cleanup?.()
        state.slots[index] = { deps, cleanup: run() }
      })
  },
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ ...state.host, invoke: state.invoke }) }))
vi.mock('../src/composer/useHostWriteAccess', () => {
  const canWrite = () => !state.viewer
  return { useHostWriteAccess: () => ({ viewOnly: state.viewer, canWrite }) }
})
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: {} }) }))
vi.mock('../src/views/searchEngine', () => ({
  useSearchEngine: () => ({ template: 'https://search.example/?q={query}' }),
}))
vi.mock('../src/views/browserNavigation', () => ({
  takeBrowserNavigation: () => undefined,
  onBrowserNavigation: () => () => {},
}))
vi.mock('../src/views/browserPane', () => ({
  takeWantedTab: () => undefined,
  onWantedTab: () => () => {},
  NEW_TAB: 'new',
}))
vi.mock('../src/views/BrowserDownloadsPopover', () => ({ BrowserDownloadsPopover: 'Popover' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/desktop-input', () => ({ Input: 'Input' }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
import { HostBrowserView } from '../src/views/HostBrowserView'
import { HostBrowserDownloads } from '../src/views/HostBrowserDownloads'
type Node = { type?: unknown; props: Record<string, any> }
const nodes = (value: unknown): Node[] =>
  !value || typeof value !== 'object'
    ? []
    : [value as Node, ...[(value as Node).props?.children].flat(Infinity).flatMap(nodes)]
const RenderBrowser = () => {
  state.cursor = 0
  return HostBrowserView({ taskId: 'task', view: { id: 'view', kind: 'browser' }, visible: true })
}
const flush = async () => {
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { hidden: false })
  state.slots = []
  state.effects = []
  state.host = { id: 'host' }
  state.viewer = false
  state.allowed = true
  state.invoke.mockReset().mockResolvedValue([])
})
afterEach(() => {
  state.viewer = true
  state.allowed = false
  for (const slot of state.slots) slot?.cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('does not poll or expose the host browser to a viewer', async () => {
  state.viewer = true
  const tree = nodes(RenderBrowser())
  await flush()
  expect(tree.some((node) => node.props.role === 'status' && node.props.children.includes('full access'))).toBe(true)
  expect(tree.some((node) => node.props.hidden === true && node.props.inert === true)).toBe(true)
  expect(state.invoke).not.toHaveBeenCalled()
})
it('keeps the address draft and refuses a retained submit and download access after a role change', async () => {
  RenderBrowser()
  await flush()
  let tree = nodes(RenderBrowser())
  const address = tree.find((node) => node.props['aria-label'] === 'Address')!
  address.props.onChange({ target: { value: 'https://kept.example' } })
  tree = nodes(RenderBrowser())
  const submit = tree.find((node) => node.type === 'form')!.props.onSubmit
  const downloads = tree.find((node) => node.type === HostBrowserDownloads)!
  state.viewer = true
  RenderBrowser()
  state.invoke.mockClear()
  submit({ preventDefault() {} })
  await flush()
  expect(state.invoke).not.toHaveBeenCalled()
  expect(downloads.props.canAccess()).toBe(false)
  state.viewer = false
  expect(nodes(RenderBrowser()).find((node) => node.props['aria-label'] === 'Address')!.props.value).toBe(
    'https://kept.example',
  )
})
it('refuses a retained download approval after its parent revokes access', async () => {
  const render = () => {
    state.cursor = 0
    return HostBrowserDownloads({ taskId: 'task', tabId: 'tab', own: true, canAccess: () => state.allowed })
  }
  const allow = nodes(render()).find((node) => node.props.children === 'Allow next download')!
  state.allowed = false
  allow.props.onClick()
  await flush()
  expect(state.invoke).not.toHaveBeenCalled()
})

it('drops a pending owner poll after access becomes view-only', async () => {
  let finish!: (value: unknown) => void
  state.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  RenderBrowser()
  await flush()
  state.viewer = true
  RenderBrowser()
  await flush()
  finish([{ id: 'tab', url: 'https://old.example' }])
  await flush()
  expect(state.invoke.mock.calls.map(([method]) => method)).toEqual(['hostBrowser.list'])
})

it('closes a restricted downloads popup without discarding its save-path draft', async () => {
  const canAccess = () => state.allowed
  const RenderDownloads = () => {
    state.cursor = 0
    return HostBrowserDownloads({ taskId: 'task', own: true, canAccess })
  }
  const first = RenderDownloads()
  first.props.onOpenChange(true)
  state.invoke.mockResolvedValue([{ id: 'file', name: 'report.txt', state: 'completed', received: 10 }])
  RenderDownloads()
  await flush()
  nodes(RenderDownloads())
    .find((node) => node.props['aria-label'] === 'Save to workspace path')!
    .props.onChange({ target: { value: 'kept/report.txt' } })
  state.allowed = false
  const restricted = RenderDownloads()
  expect(restricted.props.open).toBe(false)
  state.allowed = true
  const restored = RenderDownloads()
  expect(restored.props.open).toBe(true)
  expect(nodes(restored).find((node) => node.props['aria-label'] === 'Save to workspace path')!.props.value).toBe(
    'kept/report.txt',
  )
})

it('keeps an address draft when a retained tab selection loses host access', async () => {
  state.invoke.mockImplementation(async (method: string) =>
    method === 'hostBrowser.list'
      ? [
          { id: 'first', url: 'https://first.example', title: 'First', inputReady: false },
          { id: 'second', url: 'https://second.example', title: 'Second', inputReady: false },
        ]
      : null,
  )
  RenderBrowser()
  await flush()
  let tree = nodes(RenderBrowser())
  tree
    .find((node) => node.props['aria-label'] === 'Address')!
    .props.onChange({ target: { value: 'https://kept.example' } })
  tree = nodes(RenderBrowser())
  const select = tree.find((node) => node.props['aria-selected'] === false)!.props.onClick
  state.viewer = true
  RenderBrowser()
  select()
  state.viewer = false
  expect(nodes(RenderBrowser()).find((node) => node.props['aria-label'] === 'Address')!.props.value).toBe(
    'https://kept.example',
  )
})
