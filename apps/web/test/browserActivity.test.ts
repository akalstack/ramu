import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { BrowserActivity } from '../src/chat/BrowserActivity'

const fixture = vi.hoisted(() => ({
  openView: vi.fn(),
  activateView: vi.fn(),
  existing: null as { id: string; kind: 'browser'; tabId: string } | null,
}))
vi.mock('../src/ipc', () => ({ ramu: {} }))
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

it('keeps an owned browser discoverable without reopening the page or sending another agent message', () => {
  fixture.openView.mockClear()
  fixture.activateView.mockClear()
  fixture.existing = null
  const element = BrowserActivity({ state: { taskId: 'thread', tabs: [tab], stale: false } }) as ReactElement<{
    onClick(): void
  }>
  expect(renderToStaticMarkup(element)).toContain('1 browser tabs')
  element.props.onClick()
  expect(fixture.openView).toHaveBeenCalledWith('thread', { kind: 'browser', tabId: 'tab', url: 'https://a.test' })
  fixture.existing = { id: 'view', kind: 'browser', tabId: 'tab' }
  const existing = BrowserActivity({ state: { taskId: 'thread', tabs: [tab], stale: false } }) as ReactElement<{
    onClick(): void
  }>
  existing.props.onClick()
  expect(fixture.activateView).toHaveBeenCalledWith('thread', 'view')
})

it('keeps stale browser activity visibly qualified and disabled', () => {
  const element = BrowserActivity({ state: { taskId: 'thread', tabs: [tab], stale: true } }) as ReactElement<{
    disabled: boolean
  }>
  expect(element.props.disabled).toBe(true)
  expect(renderToStaticMarkup(element)).toContain('Last-known activity')
  expect(BrowserActivity({ state: { taskId: 'thread', tabs: [], stale: false } })).toBeNull()
})
