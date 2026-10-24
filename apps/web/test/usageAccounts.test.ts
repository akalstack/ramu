import { SettingsFieldContext } from '../src/settings/settingsField'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type UsageReading } from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  accounts: [{ id: 'second', name: 'Second account' }],
  own: [
    { provider: 'claude-code', window: 'five_hour', usedPercent: 100, status: 'limited', updatedAt: Date.now() },
  ] as UsageReading[],
  other: [
    {
      provider: 'claude-code',
      accountId: 'second',
      window: 'five_hour',
      usedPercent: 3,
      status: 'ok',
      updatedAt: Date.now(),
    },
    {
      provider: 'claude-code',
      accountId: 'second',
      window: 'weekly',
      usedPercent: 98,
      status: 'warning',
      updatedAt: Date.now(),
    },
  ] as UsageReading[],
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: () => state.own,
  useState: (initial: unknown) => [Array.isArray(initial) ? state.other : initial, vi.fn()],
  useEffect() {},
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  formatLocale: () => 'en-US',
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
}))
vi.mock('../src/ipc', () => ({ bridge: { on: vi.fn() }, invokerFor: () => vi.fn() }))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'local', invoke: vi.fn() }) }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: () => ({ on: vi.fn() }) }))
vi.mock('../src/workspace/workspaceLifetime', () => ({ workspaceVisible: () => true, onWorkspaceVisibility: vi.fn() }))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({
    preferences: {
      ...DEFAULT_APP_PREFERENCES,
      showUsageLimits: true,
      providerBinaries: { 'claude-code': { binary: '', accounts: state.accounts } },
    },
  }),
}))
vi.mock('../src/models/ProviderIcon', () => ({ ProviderIcon: () => null }))
vi.mock('../src/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  PopoverTrigger: () => null,
  PopoverContent: ({ children, className }: { children: ReactNode; className: string }) =>
    createElement('div', { className }, children),
}))
import { UsageFooter } from '../src/settings/Usage'
it('shows every allowance for other accounts and explicitly labels percentages as used', () => {
  const html = renderToStaticMarkup(createElement(UsageFooter))
  expect(html).toContain('Other Claude accounts')
  expect(html).toContain('Second account')
  expect(html).toContain('3% used')
  expect(html).toContain('98% used')
  expect(html).toContain('5-hour')
  expect(html).toContain('Weekly')
})

afterEach(() => {
  state.accounts = [{ id: 'second', name: 'Second account' }]
})
it('keeps cached account disclosure usable inside an unavailable host field', () => {
  state.accounts = ['second', 'third', 'fourth'].map((id) => ({ id, name: id }))
  const html = renderToStaticMarkup(
    createElement(SettingsFieldContext.Provider, {
      value: { path: 'usage', disabled: true, mixed: false, mark() {} },
      children: createElement(UsageFooter),
    }),
  )
  const more = html.match(/<button\b[^>]*>\+1 more<\/button>/)?.[0]
  expect(more).toBeDefined()
  expect(more).toContain('aria-expanded="false"')
  expect(more).not.toMatch(/\sdisabled=""/)
})
