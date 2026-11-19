import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  invoke: vi.fn(),
  cleanups: [] as (() => void)[],
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    state.effects.push(effect)
  },
}))
vi.mock('../src/ipc', () => ({ ramu: { invoke: state.invoke, on: () => () => {} } }))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'host' }) }))
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => ({ closeView: vi.fn() }) }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: {} }) }))
vi.mock('../src/views/searchEngine', () => ({ useSearchEngine: () => ({ template: 'https://search.test/?q=%s' }) }))
vi.mock('../src/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('../src/components/desktop-input', () => ({ Input: 'input' }))
vi.mock('../src/views/BrowserTabChip', () => ({ BrowserTabChip: 'tab' }))
import { Children, isValidElement, type ReactElement } from 'react'
import { BrowserDownloads } from '../src/views/BrowserDownloads'
import { LocalBrowserView as BrowserView } from '../src/views/BrowserView'
import { requestBrowserNavigation, takeBrowserNavigation } from '../src/views/browserNavigation'

const mount = (url?: string, visible = true) => {
  BrowserView({ taskId: 'thread', view: { kind: 'browser', id: 'view', url }, visible })
  for (const effect of state.effects.splice(0)) {
    const cleanup = effect()
    if (cleanup) state.cleanups.push(cleanup)
  }
}
const settle = async () => {
  for (let n = 0; n < 10; n++) await Promise.resolve()
}
beforeEach(() => {
  state.invoke
    .mockReset()
    .mockImplementation(async (method) =>
      method === 'browser.list' ? [] : { tab: { id: 'native', url: 'https://clicked.test' } },
    )
  takeBrowserNavigation('view', 'thread')
})
afterEach(() => {
  for (const cleanup of state.cleanups.splice(0)) cleanup()
})

it('does not create a browser page for an empty pane or a saved address', async () => {
  mount('https://saved.test')
  await settle()
  expect(state.invoke.mock.calls.every(([method]) => method === 'browser.list')).toBe(true)
  mount()
  await settle()
  expect(state.invoke).not.toHaveBeenCalledWith(
    'browser.open',
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
  )
})
it('loads a clicked link once, while saved state alone never supplies navigation intent', async () => {
  requestBrowserNavigation('view', 'thread', 'https://clicked.test')
  mount('https://saved.test')
  await settle()
  expect(state.invoke).toHaveBeenCalledWith('browser.open', 'host', 'thread', 'https://clicked.test', 'default')
  expect(takeBrowserNavigation('view', 'thread')).toBeUndefined()
  expect(state.invoke.mock.calls.filter(([method]) => method === 'browser.open')).toHaveLength(1)
})
it('keeps an explicit link queued while its pane is hidden', async () => {
  requestBrowserNavigation('view', 'thread', 'https://clicked.test')
  mount('https://saved.test', false)
  await settle()
  expect(state.invoke).not.toHaveBeenCalled()
  expect(takeBrowserNavigation('view', 'thread')).toBe('https://clicked.test')
})

it('does not let another thread consume an explicit link for a shared pane', () => {
  requestBrowserNavigation('view', 'thread', 'https://clicked.test')
  expect(takeBrowserNavigation('view', 'other-thread')).toBeUndefined()
  expect(takeBrowserNavigation('view', 'thread')).toBe('https://clicked.test')
})

it('offers a new tab after the tabs, as a browser does, and downloads in the toolbar, even with no tabs', async () => {
  const tree = BrowserView({ taskId: 'thread', view: { kind: 'browser', id: 'view' }, visible: true })
  const descendants = (node: unknown): ReactElement<Record<string, unknown>>[] => {
    if (!isValidElement<Record<string, unknown>>(node)) return []
    return [node, ...Children.toArray(node.props.children as never).flatMap(descendants)]
  }
  const toolbar = descendants(tree).find((node) => node.type === 'form')!
  const controls = descendants(toolbar)
  expect(controls.some((node) => node.type === BrowserDownloads)).toBe(true)
  const strip = descendants(tree).find((node) => node.props.role === 'tablist')!
  const add = descendants(strip).find((node) => node.props['aria-label'] === 'New browser tab')!
  expect(add.props.type).toBe('button')
  await (add.props.onClick as () => Promise<void>)()
  await settle()
  expect(state.invoke).toHaveBeenCalledWith('browser.open', 'host', 'thread', 'https://search.test', 'default')
})
