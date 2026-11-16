import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { HostOverview } from '@ramu/shared/hostOverview'
import { HostsInbox } from '../src/inbox/HostsInbox'
import { HostProvider } from '../src/workspace/HostProvider'
import { ThreadHoverCard } from '../src/sidebar/projects/ThreadHoverCard'
import { InboxRow } from '../src/inbox/InboxParts'

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
vi.mock('../src/sidebar/projects/TaskStateIcon', () => ({ StatusMark: () => null, StateDot: () => null }))
vi.mock('../src/Menu', () => ({ timeAgo: () => 'now' }))
vi.mock('../src/ipc', () => ({ ramu: {} }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: {} }) }))
vi.mock('../src/inbox/Brief', () => ({ Brief: () => null, blockerLabel: () => '' }))
vi.mock('../src/inbox/failureSeen', () => ({ useFailureSeen: () => () => false }))
vi.mock('../src/inbox/recaps', () => ({ RecapRow: () => null, notifyRecapAction: vi.fn() }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/inbox/navigation', () => ({ savedInboxTab: () => 'running', saveInboxTab: vi.fn() }))

const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [
    node,
    ...[node.props.children, node.props.render]
      .flat(Infinity)
      .flatMap((child) => elements((typeof child === 'function' ? child(new Set()) : child) as ReactNode)),
  ]
}
const rows = () => elements(HostsInbox()).filter((node) => node.type === HostProvider)
const rowOf = (host: ReturnType<typeof rows>[number]) =>
  elements(host).find((node) => node.type === InboxRow)!.props as Parameters<typeof InboxRow>[0]
/** The row's own button, as InboxRow draws it. */
const triggerOf = (host: ReturnType<typeof rows>[number]) =>
  elements(InboxRow(rowOf(host))).find((node) => typeof node.props['aria-disabled'] === 'boolean')!
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
    const card = rowOf(row).hoverCard as ReactElement<Record<string, unknown>>
    expect(card.type).toBe(ThreadHoverCard)
    expect(card.props.task).toBe(state.hosts.find((host) => host.id === row.props.hostId)!.data.tasks[0])
    expect(card.props.offline).toBe(row.props.hostId === 'b')
    expect(card.props.hostName).toBe(row.props.hostId === 'a' ? 'Laptop' : 'Server')
  }
  expect(state.select).not.toHaveBeenCalled()
})

it('leaves an offline Inbox row focusable for details and blocks navigation', () => {
  const trigger = triggerOf(rows()[1]!)
  expect(trigger.props['aria-disabled']).toBe(true)
  expect(trigger.props.focusableWhenDisabled).toBe(true)
  ;(trigger.props.onClick as () => void)()
  expect(state.select).not.toHaveBeenCalled()
})

it('opens a connected row on its exact host', () => {
  const trigger = triggerOf(rows()[0]!)
  expect(trigger.props['aria-disabled']).toBe(false)
  ;(trigger.props.onClick as () => void)()
  expect(state.select).toHaveBeenCalledExactlyOnceWith('a', { kind: 'task', taskId: 'same-id' })
})
