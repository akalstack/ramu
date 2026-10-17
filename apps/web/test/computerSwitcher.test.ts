import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { Computers } from '@ramu/shared/types'
import { ComputerSwitcher } from '../src/workspace/computers'

const state = vi.hoisted(() => ({
  scope: null as string | null,
  invoke: vi.fn(),
  items: [] as { key: string; selected?: boolean; onSelect?: () => void }[],
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => {
    subscribe(() => {})
    return snapshot()
  },
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/ipc', () => ({ invoke: state.invoke, ramu: { on: vi.fn() } }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/Menu', () => ({
  Menu: ({ icon, items }: { icon: React.ReactNode; items: typeof state.items }) => {
    state.items = items
    return createElement('button', {}, icon)
  },
}))
const snapshot = (): Computers => ({
  current: 'local',
  scope: state.scope,
  deviceName: 'Laptop',
  computers: [
    {
      id: 'local',
      name: 'This host',
      local: true,
      url: null,
      status: 'connected',
      running: 0,
      needsInput: 0,
      pairedAt: null,
    },
    {
      id: 'remote',
      name: 'Server',
      local: false,
      url: 'https://server',
      status: 'offline',
      running: 0,
      needsInput: 0,
      pairedAt: 1,
    },
  ],
})
const render = () => renderToStaticMarkup(createElement(ComputerSwitcher))

it('defaults the top selector to all hosts and filters an offline host without opening its workspace', async () => {
  state.invoke.mockImplementation(async (method: string, id: string | null) => {
    if (method === 'computers.scope') state.scope = id
    return snapshot()
  })
  render()
  await vi.waitFor(() => expect(render()).toContain('All hosts'))
  expect(state.items.find((item) => item.key === 'all')?.selected).toBe(true)
  state.items.find((item) => item.key === 'remote')!.onSelect!()
  await vi.waitFor(() => expect(render()).toContain('Server'))
  expect(state.invoke).toHaveBeenCalledWith('computers.scope', 'remote')
  expect(state.invoke).not.toHaveBeenCalledWith('computers.open', 'remote')
  expect(state.items.find((item) => item.key === 'remote')?.selected).toBe(true)
  state.items.find((item) => item.key === 'all')!.onSelect!()
  await vi.waitFor(() => expect(render()).toContain('All hosts'))
})
