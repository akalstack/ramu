import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useWorkspace } from '../src/workspace/workspace'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { BrowserActivity, showBrowserTab } from '../src/chat/BrowserActivity'
import { presentBrowser } from '../src/views/browserPane'

const fixture = vi.hoisted(() => ({
  openView: vi.fn(),
  activateView: vi.fn(),
  existing: null as { id: string; kind: 'browser'; tabId: string } | null,
}))
vi.mock('../src/ipc', () => ({ ramu: {} }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { liveViewDesktop: true } }) }))
vi.mock('../src/liveView/liveViewStore', () => ({ floatLiveView: vi.fn() }))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, values: Record<string, string | number> = {}) =>
    text.replace(/\{(\w+)\}/g, (_all, key) => String(values[key])),
}))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({
    openView: fixture.openView,
    activateView: fixture.activateView,
    workspaceOf: () => 'scope',
    taskUi: { scope: { views: fixture.existing ? [fixture.existing] : [] } },
  }),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'local' }) }))
const tab: BrowserTabInfo = {
  id: 'tab',
  hostId: 'local',
  threadId: 'thread',
  runId: 'run',
  profileId: 'default',
  url: 'https://a.test',
  title: 'A',
  controller: 'agent',
  generation: 1,
  paused: false,
  inputReady: false,
  crashed: false,
}

it('shows an owned browser tab without reopening the page, reusing its pane when it exists', () => {
  fixture.openView.mockClear()
  fixture.activateView.mockClear()
  const ws = useWorkspace()
  fixture.existing = null
  showBrowserTab(ws, 'thread', tab)
  expect(fixture.openView).toHaveBeenCalledWith('thread', { kind: 'browser', tabId: 'tab', url: 'https://a.test' })
  fixture.existing = { id: 'view', kind: 'browser', tabId: 'tab' }
  showBrowserTab(useWorkspace(), 'thread', tab)
  expect(fixture.activateView).toHaveBeenCalledWith('thread', 'view')
})

it('lists each tab with who controls it, qualifies stale activity and hides when there are no tabs', () => {
  const html = renderToStaticMarkup(
    BrowserActivity({ state: { taskId: 'thread', tabs: [tab], stale: false, close: vi.fn() } }),
  )
  expect(html).toContain('https://a.test')
  expect(html).toContain('Agent control')
  expect(html).toContain('New browser tab')
  expect(html).toContain('aria-label="Close tab"')
  const stale = renderToStaticMarkup(
    BrowserActivity({ state: { taskId: 'thread', tabs: [tab], stale: true, close: vi.fn() } }),
  )
  expect(stale).toContain('Last-known activity')
  expect(stale).not.toContain('New browser tab')
  expect(BrowserActivity({ state: { taskId: 'thread', tabs: [], stale: false, close: vi.fn() } })).toBeNull()
})

it('reveals a deliberate agent presentation only in the active thread and host', () => {
  fixture.existing = null
  fixture.openView.mockClear()
  const workspace = { ...useWorkspace(), ui: { activeTaskId: 'thread' } }
  expect(presentBrowser(workspace, 'another-host', tab)).toBe(false)
  expect(presentBrowser({ ...workspace, ui: { activeTaskId: 'other' } }, 'local', tab)).toBe(false)
  expect(fixture.openView).not.toHaveBeenCalled()
  expect(presentBrowser(workspace, 'local', tab)).toBe(true)
  expect(fixture.openView).toHaveBeenCalledWith('thread', { kind: 'browser', tabId: 'tab', url: 'https://a.test' })
})
