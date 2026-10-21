import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
const state = vi.hoisted(() => ({
  host: 'host-a',
  queries: [] as { queryKey: unknown[]; enabled: boolean }[],
  openTask: vi.fn(),
  openView: vi.fn(),
  buttons: [] as React.ComponentProps<'button'>[],
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, params: Record<string, string | number> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? key)),
}))
vi.mock('../src/components/ui/hover-card', () => ({
  HoverCardContent: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: state.host }) }))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspaceActions: () => ({ openTask: state.openTask, openView: state.openView }),
}))
vi.mock('@/components/desktop-button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string; size?: string }) => {
    state.buttons.push(props)
    return createElement('button', props)
  },
}))
vi.mock('../src/dataQueries', () => ({ ipcQueryKeyOn: (...args: unknown[]) => args, cachedDataOn: () => undefined }))
vi.mock('../src/git/hostQuery', () => ({
  queryInvokerFor: () => () => {
    throw new Error('read-only card must not mutate')
  },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[]; enabled: boolean }) => {
    state.queries.push(options)
    return { data: [], isPending: false, isError: false }
  },
  useQueries: () => [],
}))
import { ThreadHoverCard } from '../src/sidebar/projects/ThreadHoverCard'
const task: Task = {
  id: 'thread',
  projectId: 'project',
  title: 'Fix build',
  mode: 'current',
  workspaceId: null,
  status: 'running',
  createdAt: 1,
  pinnedAt: null,
  lastActiveAt: 1,
  inputSummary: {
    count: 4,
    approvals: 1,
    requests: [
      {
        sessionId: 'main',
        requestId: 'forwarded',
        kind: 'approval',
        title: 'Run build',
        source: { sessionId: 'child', agentId: 'helper', name: 'Builder', requestId: 'native' },
      },
    ],
  },
}
const render = (value = task, offline = false) =>
  renderToStaticMarkup(
    createElement(ThreadHoverCard, {
      task: value,
      status: threadStatus(value, false),
      sharedWorkspace: false,
      offline,
    }),
  )
beforeEach(() => {
  state.queries = []
  state.host = 'host-a'
  state.buttons = []
  state.openTask.mockClear()
  state.openView.mockClear()
})
it('opens the exact forwarded request through the displayed host workspace without answering it', () => {
  render()
  const button = state.buttons.find((button) => String(button.children).includes('Run build'))!
  button.onClick!({ stopPropagation() {} } as React.MouseEvent<HTMLButtonElement>)
  expect(state.openTask).toHaveBeenCalledWith('thread')
  expect(state.openView).toHaveBeenCalledWith('thread', {
    kind: 'agent',
    sessionId: 'main',
    focusRequestId: 'forwarded',
  })
})
it('shows approval, bounded request context and helper origin in the existing thread card', () => {
  const markup = render()
  expect(markup).toContain('Approval needed')
  expect(markup).toContain('4 input requests')
  expect(markup).toContain('Run build')
  expect(markup).toContain('From Builder')
  expect(state.queries[0]!.queryKey).toContain('host-a')
  expect(state.queries[0]!.enabled).toBe(true)
})
it('distinguishes a pending verification from a failed latest check', () => {
  const goalState = { status: 'active' as const, objective: 'Fix build', verifying: true, verificationFailed: true }
  const pending = render({ ...task, goalState })
  expect(pending).toContain('Verifying goal')
  expect(pending).not.toContain('Verification failed')
  const failed = render({ ...task, goalState: { ...goalState, verifying: false } })
  expect(failed).toContain('Verification failed')
  expect(failed).not.toContain('Verifying goal')
})
it('keeps offline details qualified and cannot fetch another host branch or invent old-host request context', () => {
  state.host = 'host-b'
  const markup = render(task, true)
  expect(markup).toContain('Offline · last-known activity')
  expect(state.queries[0]!.queryKey).toContain('host-b')
  expect(state.queries[0]!.enabled).toBe(false)
  const legacy = render({ ...task, status: 'needs-input', inputSummary: undefined })
  expect(legacy).toContain('Waiting for your input')
  expect(legacy).not.toContain('Run build')
  expect(legacy).not.toContain('Approval needed')
})
