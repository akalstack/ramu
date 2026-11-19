import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '@ramu/shared/account'
import type { ForgeConnectionSummary } from '@ramu/shared/types'
import { githubSetup } from '../src/onboarding/githubSetup'

const state = vi.hoisted(() => ({ account: null as AccountStatus | null }))
vi.mock('../src/i18n', () => ({
  t: (text: string, values?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? ''),
  useLanguage: () => 'en',
}))
vi.mock('../src/ipc', () => ({ invoke: vi.fn(), ramu: { on: () => () => {} } }))
vi.mock('../src/models/ProviderSetupTerminal', () => ({ runProviderCommand: vi.fn() }))
vi.mock('../src/git/CommentAvatar', () => ({
  CommentAvatar: ({ name }: { name: string }) => createElement('span', { 'data-avatar': '' }, name),
}))
vi.mock('../src/settings/AccountProfile', async (original) => ({
  ...(await original<typeof import('../src/settings/AccountProfile')>()),
  useOwnAccount: () => state.account,
}))

const { AccountSignIn } = await import('../src/onboarding/SignInRows')

const summary = (extra: Partial<ForgeConnectionSummary>): ForgeConnectionSummary => ({
  cli: 'signed-in',
  accounts: [],
  checkedAt: 0,
  saved: [],
  ...extra,
})
const cliAccount = (state: 'ok' | 'invalid') =>
  ({
    host: 'github.com',
    login: 'ada',
    active: true,
    state,
    scopes: [],
  }) as unknown as ForgeConnectionSummary['accounts'][number]
const savedToken = (state: string) =>
  ({
    id: 'c1',
    origin: 'github.com',
    enabled: true,
    selected: true,
    state,
  }) as unknown as ForgeConnectionSummary['saved'][number]

describe('GitHub in the Identities step', () => {
  it('asks for nothing once the GitHub CLI or a chosen saved token works', () => {
    expect(githubSetup(summary({ accounts: [cliAccount('ok')] }))).toBe('ready')
    expect(githubSetup(summary({ cli: 'no-cli', saved: [savedToken('connected')] }))).toBe('ready')
  })

  it('signs in from a terminal when the CLI is installed but has no working account', () => {
    expect(githubSetup(summary({ cli: 'signed-out' }))).toBe('sign-in')
    expect(githubSetup(summary({ accounts: [cliAccount('invalid')] }))).toBe('sign-in')
  })

  it('points to installing the CLI when it is missing and no token works', () => {
    expect(githubSetup(summary({ cli: 'no-cli' }))).toBe('install')
    expect(githubSetup(summary({ cli: 'no-cli', saved: [savedToken('failed')] }))).toBe('install')
  })
})

const account = (extra: Partial<AccountStatus>): AccountStatus => ({
  signedIn: false,
  user: null,
  providers: [],
  backup: { account: false, github: false, lastBackupAt: null, error: null, hasKey: false },
  listed: false,
  trust: 'owner',
  pendingSignIn: null,
  ...extra,
})
const render = () => renderToStaticMarkup(createElement(AccountSignIn, { onError: () => {} }))

describe('the Ramu account in the Other devices step', () => {
  it('offers an optional sign-in when signed out', () => {
    state.account = account({})
    const html = render()
    expect(html).toContain('Optional and free')
    expect(html).toContain('Sign in')
  })

  it('shows the code to match while a sign-in waits', () => {
    state.account = account({
      pendingSignIn: { userCode: 'ABCD-1234', verificationUri: 'https://example.com', expiresAt: 0 },
    })
    const html = render()
    expect(html).toContain('Code: ABCD-1234')
    expect(html).toContain('Open the sign-in page')
  })

  it('once signed in, offers listing the host with its switch off until chosen', () => {
    state.account = account({
      signedIn: true,
      user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null },
      providers: ['github'],
    })
    const html = render()
    expect(html).toContain('Ada')
    expect(html).toContain('Let my signed-in devices connect')
    expect(html).toMatch(/aria-checked="false"|data-unchecked/)
  })

  it('shows nothing when this device may not read the account', () => {
    state.account = null
    expect(render()).toBe('')
  })
})
