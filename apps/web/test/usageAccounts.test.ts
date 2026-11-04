import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type UsageReading } from '@ramu/shared/types'

const reading = (accountId: string | undefined, window: UsageReading['window'], usedPercent: number): UsageReading => ({
  provider: 'claude-code',
  ...(accountId ? { accountId } : {}),
  window,
  usedPercent,
  status: usedPercent >= 100 ? 'limited' : 'ok',
  updatedAt: Date.now(),
})
const state = vi.hoisted(() => ({ hosts: [] as unknown[], reveal: false }))
state.hosts = [
  {
    hostId: 'local',
    host: 'Mac',
    readings: [reading(undefined, 'five_hour', 74), reading('second', 'five_hour', 100)],
    emails: { 'claude-code': { default: 'me@x.io', second: 'team@x.io' } },
    logins: {},
    config: undefined,
  },
  {
    hostId: 'vps',
    host: 'vps',
    readings: [reading('acc-9', 'weekly', 66)],
    emails: { 'claude-code': { 'acc-9': 'ME@x.io' } },
    logins: {},
    config: { 'claude-code': { binary: '', accountId: 'acc-9' } },
  },
]
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: () => [reading(undefined, 'five_hour', 74)],
  // The dialog is open, its hosts are read, and names stay hidden until revealed.
  useState: (initial: unknown) => [
    initial === false ? true : initial === null ? state.hosts : typeof initial === 'function' ? state.reveal : initial,
    vi.fn(),
  ],
  useEffect() {},
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  formatLocale: () => 'en-US',
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
}))
vi.mock('../src/ipc', () => ({ bridge: { on: vi.fn() }, invokerFor: () => vi.fn(), invokeOn: vi.fn() }))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'local', invoke: vi.fn() }) }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => ({ computers: [] }) }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: () => ({ on: vi.fn() }) }))
vi.mock('../src/workspace/workspaceLifetime', () => ({ workspaceVisible: () => true, onWorkspaceVisibility: vi.fn() }))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({
    preferences: {
      ...DEFAULT_APP_PREFERENCES,
      showUsageLimits: true,
      providerBinaries: { 'claude-code': { binary: '', accounts: [{ id: 'second', name: 'Team' }] } },
    },
  }),
}))
vi.mock('../src/models/ProviderIcon', () => ({ ProviderIcon: () => null }))
vi.mock('@/components/ui/dialog', () => {
  const box = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return { Dialog: box, DialogContent: box, DialogHeader: box, DialogTitle: box, DialogDescription: box }
})
import { UsageFooter } from '../src/settings/Usage'

it('shows a login signed in on two hosts once, with where it is used, and every other login', () => {
  const html = renderToStaticMarkup(createElement(UsageFooter))
  // One row for me@x.io across Mac and vps, one for the second login: two, not three.
  expect(html).toContain('2 logins · 1 with room')
  expect(html).toContain('This host · in use')
  expect(html).toContain('vps · in use')
  expect(html).toContain('In use')
  expect(html).toContain('74% used')
  expect(html).toContain('66% used')
  expect(html).toContain('Limit reached')
  expect(html).toContain('A login signed in on several hosts shows once.')
  // Names stay hidden until revealed: the second login is numbered, not called Team.
  expect(html).not.toContain('team@x.io')
  expect(html).not.toContain('me@x.io')
})
