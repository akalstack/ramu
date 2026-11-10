import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { Identity, IdentitySnapshot } from '@ramu/shared/identities'

const state = vi.hoisted(() => ({ snapshot: null as IdentitySnapshot | null }))
vi.mock('../src/i18n', () => ({
  t: (text: string, values?: Record<string, string>) => text.replace('{0}', values?.[0] ?? ''),
}))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('../src/workspace/identities', () => ({
  useIdentities: () => state.snapshot,
  refreshIdentities: async () => {},
}))
vi.mock('../src/settings/SettingsScope', async () => {
  const { createContext } = await import('react')
  return { SettingsScopeContext: createContext(null), useSettingsInvoke: () => vi.fn() }
})
// The menu shows its trigger and each choice's label, which is what a person reads.
vi.mock('../src/Menu', () => ({
  Menu: ({ label, icon, items }: { label: string; icon: ReactNode; items: { key: string; label: ReactNode }[] }) =>
    createElement(
      'div',
      { 'aria-label': label },
      icon,
      items.map((item) => createElement(Fragment, { key: item.key }, '|', item.label)),
    ),
}))

const { AccountIdentityPicker, accountSection } = await import('../src/settings/AccountIdentity')

const identity = (id: string, name: string): Identity => ({
  id,
  name,
  color: id === 'work' ? 'blue' : 'violet',
  gitAuthor: { name, email: `${id}@example.com` },
  rules: [],
  isDefault: id === 'personal',
  createdAt: 1,
})
const snapshot = (identities: Identity[], accounts: Record<string, string[]> = {}): IdentitySnapshot => ({
  settings: { identities, accounts, pins: {} },
  projects: [],
  accounts: [],
  gitUser: { name: null, email: null },
})
const picker = () =>
  renderToStaticMarkup(createElement(AccountIdentityPicker, { accountKey: 'media:elevenlabs', name: 'ElevenLabs' }))

it('shows nothing about identities while the host has fewer than two', () => {
  state.snapshot = snapshot([identity('personal', 'Personal')])
  expect(picker()).toBe('')
  state.snapshot = null
  expect(picker()).toBe('')
})

it('names the identity an account is in, offering All identities and each identity', () => {
  state.snapshot = snapshot([identity('personal', 'Personal'), identity('work', 'Work')], {
    'media:elevenlabs': ['work'],
  })
  const html = picker()
  expect(html).toContain('aria-label="Identity for ElevenLabs · Work"')
  expect(html).toContain('bg-blue-500')
  expect(html).toContain('All identities')
  expect(html).toContain('Personal')
})

it('reads an account with no identity as for all identities', () => {
  state.snapshot = snapshot([identity('personal', 'Personal'), identity('work', 'Work')])
  expect(picker()).toContain('aria-label="Identity for ElevenLabs · All identities"')
})

it('sends a guardrail card to the page where that kind of account is connected', () => {
  expect(accountSection('provider:claude-code:default')).toBe('providers')
  expect(accountSection('forge:github:cli-octocat')).toBe('git')
  expect(accountSection('plugin:vercel-cli')).toBe('plugins')
  expect(accountSection('media:gemini')).toBe('providers')
  expect(accountSection('mcp:linear')).toBe('agent-setup')
  expect(accountSection('browser:default')).toBe('browser')
})
