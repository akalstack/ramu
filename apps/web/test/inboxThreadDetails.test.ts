import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { HostOverview } from '@ramu/shared/hostOverview'
import { HostsInbox } from '../src/inbox/HostsInbox'
import { HostProvider } from '../src/workspace/HostProvider'
import { ThreadHoverCard } from '../src/sidebar/projects/ThreadHoverCard'

const state = vi.hoisted(() => ({
  select: vi.fn(),
  computers: [
    { id: 'a', name: 'Laptop', status: 'connected' },
    { id: 'b', name: 'Server', status: 'offline' },
  ],
  hosts: [] as { id: string; data: HostOverview }[],
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => ['running', vi.fn()],
  useEffect() {},
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/workspace/computers', () => ({
  useComputers: () => ({ computers: state.computers, scope: null }),
  statusText: String,
}))
vi.mock('../src/workspace/hostOverview', () => ({ useHostOverviews: () => state.hosts }))
vi.mock('../src/workspace/HostSelection', () => ({ useHostSelection: () => ({ select: state.select }) }))
vi.mock('../src/workspace/HostProvider', () => ({ HostProvider: () => null }))
vi.mock('../src/sidebar/projects/ThreadHoverCard', () => ({ ThreadHoverCard: () => null }))
vi.mock('../src/sidebar/projects/TaskStateIcon', () => ({ StatusMark: () => null }))
vi.mock('../src/Menu', () => ({ timeAgo: () => 'now' }))
vi.mock('../src/ipc', () => ({ ramu: {} }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: {} }) }))
vi.mock('../src/inbox/Brief', () => ({ Brief: () => null, blockerLabel: () => '' }))
vi.mock('../src/inbox/Resources', () => ({
  RunningTab: ({ children }: { children: (listed: Set<string>) => unknown }) => children(new Set()),
}))
vi.mock('../src/inbox/failureSeen', () => ({ useFailureSeen: () => () => false }))
vi.mock('../src/inbox/recaps', () => ({ SnoozeMenu: () => null, notifyRecapAction: vi.fn() }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/inbox/navigation', () => ({ savedInboxTab: () => 'running', saveInboxTab: vi.fn() }))

const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [
    node,
    ...[node.props.children]
      .flat(Infinity)
      .flatMap((child) => elements((typeof child === 'function' ? child(new Set()) : child) as ReactNode)),
  ]
}
const rows = () => elements(HostsInbox()).filter((node) => node.type === HostProvider)
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null })
  state.hosts = ['a', 'b'].map((id) => ({
    id,
    data: {
      projects: [],
      agents: [],
      recaps: [],
      summaries: [],
      errors: [],
      tasks: [
        {
          id: 'same-id',
          title: `${id} thread`,
          projectId: 'project',
          mode: 'current',
          workspaceId: null,
          status: 'running',
          createdAt: 1,
          lastActiveAt: Date.now(),
          pinnedAt: null,
        },
      ],
    },
  }))
})

it('keeps colliding Inbox thread IDs and their context cards in the owning host', () => {
  const list = rows()
  expect(list.map((row) => row.props.hostId)).toEqual(['a', 'b'])
  for (const row of list) {
    const card = elements(row).find((node) => node.type === ThreadHoverCard)!
    expect(card.props.task).toBe(state.hosts.find((host) => host.id === row.props.hostId)!.data.tasks[0])
    expect(card.props.offline).toBe(row.props.hostId === 'b')
    expect(card.props.hostName).toBe(row.props.hostId === 'a' ? 'Laptop' : 'Server')
  }
  expect(state.select).not.toHaveBeenCalled()
})

it('leaves an offline Inbox row focusable for details and blocks navigation', () => {
  const trigger = elements(rows()[1]).find((node) => node.props['aria-disabled'] === true)!
  expect(trigger.props.disabled).toBeUndefined()
  ;(trigger.props.onClick as () => void)()
  expect(state.select).not.toHaveBeenCalled()
})

it('opens a connected row on its exact host', () => {
  const trigger = elements(rows()[0]).find((node) => node.props['aria-disabled'] === false)!
  ;(trigger.props.onClick as () => void)()
  expect(state.select).toHaveBeenCalledExactlyOnceWith('a', { kind: 'task', taskId: 'same-id' })
})
