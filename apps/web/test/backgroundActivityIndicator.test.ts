import { cloneElement, createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { translate } from '@ramu/shared/i18n'
import { BackgroundActivityIndicator } from '../src/chat/BackgroundActivity'
import type { CenterNotice } from '../src/chat/notificationCenter'

const state = vi.hoisted(() => ({
  missed: [] as CenterNotice[],
  buttons: [] as { children?: ReactNode; onClick?: () => void; 'aria-label'?: string }[],
  invoke: vi.fn(async () => {}),
  clear: vi.fn(),
  rejected: false,
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (s: string, values?: Record<string, string | number>) => translate('en', s, values),
}))
vi.mock('../src/ipc', () => ({ ramu: {} }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'host', invoke: state.invoke }) }))
vi.mock('../src/workspace/workspaceLifetime', () => ({ workspaceVisible: () => true, onWorkspaceVisibility: vi.fn() }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: vi.fn() }))
vi.mock('../src/workspace/computers', () => ({
  useComputers: () => ({ computers: [{ id: 'host', status: state.rejected ? 'rejected' : 'connected' }] }),
}))
vi.mock('../src/chat/notificationCenter', () => ({
  useNotices: () => state.missed,
  notices: { clear: state.clear, remove: vi.fn() },
  useStatusPanel: () => () => {},
}))
vi.mock('../src/components/desktop-button', () => ({
  Button: (props: (typeof state.buttons)[number]) => {
    state.buttons.push(props)
    return createElement('button', { 'aria-label': props['aria-label'], onClick: props.onClick }, props.children)
  },
}))
// Render portal contents on the server so the section labels and existing actions are observable.
vi.mock('../src/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  PopoverHeader: ({ children }: { children: ReactNode }) => createElement('header', null, children),
  PopoverTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  PopoverTrigger: ({ render, ...props }: { render: ReactElement }) => cloneElement(render, props),
}))
const job = { id: 'update', label: 'Updating CLI', detail: 'antigravity', cancellable: true }
const notice: CenterNotice = { id: 'done', title: 'Agent finished', type: 'success', at: 1 }
const render = (items = [job], connected = true, onStop = vi.fn(async () => {})) =>
  renderToStaticMarkup(createElement(BackgroundActivityIndicator, { items, connected, onStop }))
const trigger = (html: string, label: string) =>
  html.match(new RegExp(`<button aria-label="${label}"[^>]*>(.*?)</button>`, 's'))?.[1]
beforeEach(() => {
  state.missed = []
  state.buttons = []
  state.rejected = false
  vi.clearAllMocks()
})

it('counts notifications separately from jobs and names a single running job', () => {
  state.missed = [notice]
  const html = render()
  expect(trigger(html, 'Notifications')).toContain('>1</span>')
  expect(trigger(html, 'Background activity')).toContain('Updating CLI')
  expect(html).toContain('aria-label="Running"')
  expect(html).toContain('aria-label="Notifications"')
  expect(html.indexOf('aria-label="Running"')).toBeLessThan(html.indexOf('<section aria-label="Notifications"'))
})
it('collapses multiple jobs to a count without putting them in the bell', () => {
  const html = render([job, { ...job, id: 'other' }])
  expect(trigger(html, 'Background activity')).toContain('2 running')
  expect(trigger(html, 'Notifications')).not.toContain('<span')
})
it('hides the task trigger while idle and keeps a useful empty state', () => {
  const html = render([])
  expect(trigger(html, 'Background activity')).toBeUndefined()
  expect(html).toContain('You are all caught up')
  expect(html).toContain('Notifications and activity')
})
it('keeps the connection warning visible alongside retained notifications', () => {
  state.missed = [notice]
  state.rejected = true
  const html = render([job], false)
  expect(html).toContain('Pair again')
  expect(html).not.toContain('Updating CLI')
  expect(trigger(html, 'Notifications')).toContain('>1</span>')
})
it('offers Stop only for cancellable jobs and routes it to that job', async () => {
  const stop = vi.fn(async () => {})
  render([job, { ...job, id: 'git', label: 'Pushing repository changes', cancellable: false }], true, stop)
  expect(state.buttons.find((b) => b['aria-label'] === 'Stop Pushing repository changes')).toBeUndefined()
  state.buttons.find((b) => b['aria-label'] === 'Stop Updating CLI')!.onClick!()
  expect(stop).toHaveBeenCalledWith('update')
})
it('keeps clearing and dismissing notifications independent of running jobs', () => {
  const dismiss = vi.fn()
  state.missed = [{ ...notice, onDismiss: dismiss }]
  render()
  state.buttons.find((b) => b['aria-label'] === 'Dismiss notification')!.onClick!()
  expect(dismiss).toHaveBeenCalledOnce()
  state.buttons.find((b) => b.children === 'Clear all')!.onClick!()
  expect(state.clear).toHaveBeenCalledOnce()
  expect(state.invoke).toHaveBeenCalledWith('notices.clear')
})
