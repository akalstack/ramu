import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProviderConfiguration } from '@ramu/shared/providers/providers'
import {
  DEFAULT_APP_PREFERENCES,
  type AgentSettings,
  type ProviderCatalog,
  type UsageReading,
} from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  menus: [] as { label: string; className: string; items: any[]; disabled?: boolean }[],
  usage: [] as UsageReading[],
  accountUsage: [] as UsageReading[],
  providerBinaries: {} as ProviderConfiguration,
  calls: [] as unknown[][],
}))
const catalogs: ProviderCatalog[] = [
  {
    provider: 'claude-code',
    models: [
      {
        provider: 'claude-code',
        id: 'sonnet',
        name: 'Sonnet',
        efforts: ['low'],
        defaultEffort: 'low',
        isDefault: true,
      },
    ],
  },
  {
    provider: 'codex',
    models: [
      { provider: 'codex', id: 'gpt-x', name: 'GPT X', efforts: ['low'], defaultEffort: 'low', isDefault: true },
    ],
  },
]
vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  formatLocale: () => 'en-US',
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)),
}))
vi.mock('../src/Menu', () => ({
  Menu: (props: { label: string; className: string; items: any[] }) => {
    state.menus.push(props)
    return createElement('span', { 'data-menu': props.label })
  },
}))
vi.mock('../src/settings/Usage', () => ({
  useUsage: () => state.usage,
  useAccountUsage: () => state.accountUsage,
  resetText: () => null,
  usageTone: () => 'bad',
  windowLabel: () => '5h',
}))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({
    preferences: { ...DEFAULT_APP_PREFERENCES, showUsageLimits: true, providerBinaries: state.providerBinaries },
  }),
}))
vi.mock('../src/models/ModelSets', () => ({
  useModelSets: () => ({ catalogs }),
  modelDisplayName: (name: string) => name,
}))
vi.mock('../src/models/ProviderIcon', () => ({ ProviderIcon: () => null }))
vi.mock('../src/ipc', () => ({
  invoke: (...args: unknown[]) => {
    state.calls.push(args)
    return Promise.resolve(args[0] === 'agent.providerHold' ? null : { id: 's' })
  },
}))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({
    id: 'local',
    isLocal: true,
    status: 'connected',
    invoke: (...args: unknown[]) => {
      state.calls.push(args)
      return Promise.resolve(args[0] === 'agent.providerHold' ? null : { id: 's' })
    },
  }),
}))
vi.mock('../src/chat/Notifications', () => ({ notifyError: () => {} }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: (error: unknown) => String(error) }))

const { ProviderRouteChip } = await import('../src/models/ProviderRoute')
const { autoResumeControl } = await import('../src/models/autoResumeMenu')

const settings: AgentSettings = {
  provider: 'claude-code',
  model: 'sonnet',
  effort: 'low',
  access: 'full',
  autoFallback: true,
}
const control = autoResumeControl({}, undefined, () => {})
const render = (props: { limited?: boolean; withControl?: boolean; accountId?: string; readOnly?: boolean }) =>
  renderToStaticMarkup(
    createElement(ProviderRouteChip, {
      sessionId: 's',
      settings: { ...settings, accountId: props.accountId },
      limited: props.limited,
      readOnly: props.readOnly,
      autoResume: props.withControl === false ? undefined : control,
    }),
  )
const labels = (items: any[]) => items.map((item) => item.label ?? item.heading ?? '—')
beforeEach(() => {
  state.menus = []
  state.usage = []
  state.accountUsage = []
  state.providerBinaries = {}
  state.calls = []
})

it('always offers Auto-resume, even far from any limit, as a quiet icon with the same three items', () => {
  const html = render({})
  expect(html).toContain('data-menu="Auto-resume: On (default)"')
  const [menu] = state.menus
  expect(menu!.className).toContain('w-7')
  expect(labels(menu!.items)).toEqual([
    'Auto-resume at a usage limit',
    'Use default (on)',
    'On',
    'Off',
    '—',
    'Fallback settings…',
  ])
})

it('renders nothing when there is no control and nothing to warn about', () => {
  expect(render({ withControl: false })).toBe('')
})

it('keeps the three Auto-resume items in the chip near a limit and at one', () => {
  state.usage = [
    { provider: 'claude-code', window: 'five_hour', usedPercent: 92, status: 'warning', updatedAt: Date.now() },
  ]
  render({})
  expect(labels(state.menus[0]!.items)).toEqual(expect.arrayContaining(['Use default (on)', 'On', 'Off']))
  state.menus = []
  render({ limited: true })
  expect(labels(state.menus[0]!.items)).toEqual(expect.arrayContaining(['Use default (on)', 'On', 'Off']))
})

it('at a limit offers to continue on each other provider that is not limited, before Auto-resume', () => {
  render({ limited: true })
  const items = state.menus[0]!.items
  expect(labels(items)[0]).toMatch(/ · Limit reached$/)
  expect(labels(items).slice(1, 4)).toEqual(['Continue on another provider', 'Continue with Codex', '—'])
  expect(labels(items)[4]).toBe('Auto-resume at a usage limit')
})

it('hides Continue with when every other provider is limited', () => {
  state.usage = [
    {
      provider: 'codex',
      window: 'five_hour',
      usedPercent: 100,
      status: 'limited',
      updatedAt: Date.now(),
      resetsAt: Date.now() + 3_600_000,
    },
  ]
  render({ limited: true })
  expect(labels(state.menus[0]!.items).some((label) => String(label).startsWith('Continue'))).toBe(false)
})

it('choosing Continue with switches the thread to that provider and then tries again', async () => {
  render({ limited: true })
  const item = state.menus[0]!.items.find((entry) => entry.key === 'continue-codex')
  item.onSelect()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const configure = state.calls.find((call) => call[0] === 'agent.configure')!
  expect(configure.slice(0, 2)).toEqual(['agent.configure', 's'])
  expect(configure[2]).toMatchObject({ provider: 'codex', model: 'gpt-x', access: 'full', autoFallback: true })
  expect(state.calls.map((call) => call[0]).filter((name) => /configure|retryLimitNow/.test(String(name)))).toEqual([
    'agent.configure',
    'agent.retryLimitNow',
  ])
})

it('previews a switch to another Claude account before Codex and reads the thread account independently', () => {
  state.providerBinaries = { 'claude-code': { binary: '', accounts: [{ id: 'second', name: 'Second' }] } }
  state.accountUsage = [
    { provider: 'claude-code', window: 'five_hour', usedPercent: 100, status: 'limited', updatedAt: Date.now() },
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
  ]
  render({})
  expect(state.menus[0]!.label).toContain('Sending with Claude:')
  state.menus = []
  render({ accountId: 'second' })
  expect(state.menus[0]!.label).not.toContain('Sending with')
  expect(state.menus[0]!.label).not.toContain('limited')
})

it('keeps provider status visible while disabling routing controls for a viewer', () => {
  for (const limited of [false, true]) {
    state.menus = []
    const html = render({ limited, readOnly: true })
    expect(html).toContain('data-menu=')
    expect(state.menus.every((menu) => menu.disabled)).toBe(true)
  }
})
