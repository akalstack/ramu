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
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
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

it('streams frames separately from metadata and stops both when the window is backgrounded', async () => {
  const tab = { id: 'tab', generation: 1, controller: 'agent', url: 'https://site.example', inputReady: false }
  let finish!: (frame: unknown) => void
  state.invoke.mockImplementation(async (method: string) => {
    if (method === 'hostBrowser.list') return [tab]
    if (method === 'hostBrowser.nextFrame')
      return new Promise((resolve) => {
        finish = resolve
      })
    return null
  })
  RenderBrowser()
  await flush()
  RenderBrowser()
  await flush()
  expect(state.invoke.mock.calls.map(([method]) => method)).toContain('hostBrowser.nextFrame')
  expect(state.invoke.mock.calls.map(([method]) => method)).not.toContain('hostBrowser.frame')
  const changed = vi
    .mocked(document.addEventListener)
    .mock.calls.find(([name]) => name === 'visibilitychange')![1] as () => void
  Object.assign(document, { hidden: true })
  changed()
  RenderBrowser()
  await flush()
  expect(state.invoke).toHaveBeenCalledWith('hostBrowser.disconnect')
  finish({ mimeType: 'image/jpeg', data: 'late', width: 100, height: 100, sequence: 1 })
  await flush()
  expect(nodes(RenderBrowser()).some((node) => node.props.src?.includes('late'))).toBe(false)
})

it('keeps wheel gestures responsive while earlier input is in flight and preserves their order', async () => {
  const tab = { id: 'tab', generation: 1, controller: 'human', url: 'https://site.example', inputReady: true }
  let finish!: () => void
  state.invoke.mockImplementation(async (method: string) => {
    if (method === 'hostBrowser.list') return [tab]
    if (method === 'hostBrowser.take') return tab
    if (method === 'hostBrowser.nextFrame')
      return { mimeType: 'image/jpeg', data: 'image', width: 100, height: 100, sequence: 1 }
    if (method === 'hostBrowser.input')
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    return null
  })
  RenderBrowser()
  await flush()
  RenderBrowser()
  await flush()
  let tree = nodes(RenderBrowser())
  tree.find((node) => node.props.children === 'Take control')!.props.onClick()
  await flush()
  RenderBrowser()
  await flush()
  tree = nodes(RenderBrowser())
  const page = tree.find((node) => node.props['aria-label'] === 'Page')!
  const element = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  page.props.ref(element)
  const wheel = element.addEventListener.mock.calls[0]![1] as (event: unknown) => void
  expect(element.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false })
  const preventDefault = vi.fn()
  wheel({ preventDefault, deltaX: 0, deltaY: 10 })
  wheel({ preventDefault, deltaX: 0, deltaY: 20 })
  wheel({ preventDefault, deltaX: 0, deltaY: 30 })
  expect(preventDefault).toHaveBeenCalledTimes(3)
  expect(state.invoke.mock.calls.filter(([method]) => method === 'hostBrowser.input')).toHaveLength(1)
  finish()
  await flush()
  expect(
    state.invoke.mock.calls.filter(([method]) => method === 'hostBrowser.input').map((call) => call.at(-1)),
  ).toEqual([
    { kind: 'scroll', x: 0, y: 10 },
    { kind: 'scroll', x: 0, y: 50 },
  ])
  finish()
  await flush()
})
