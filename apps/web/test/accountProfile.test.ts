import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountStatus, AccountUser } from '@ramu/shared/account'

const state = vi.hoisted(() => ({ account: null as AccountStatus | null }))
vi.mock('../src/i18n', () => ({
  t: (text: string, values?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? ''),
  useLanguage: () => 'en',
}))
vi.mock('../src/ipc', () => ({ invoke: vi.fn(), ramu: { on: () => () => {} } }))
vi.mock('../src/commands', () => ({ formatKeys: (keys: string) => keys }))
vi.mock('../src/appearance', () => ({ useResolvedAppearance: () => 'dark' }))
vi.mock('../src/git/CommentAvatar', () => ({
  CommentAvatar: ({ name, url }: { name: string; url?: string }) =>
    createElement('span', { 'data-avatar': url ?? 'initials' }, name),
}))
vi.mock('../src/settings/AccountProfile', async (original) => ({
  ...(await original<typeof import('../src/settings/AccountProfile')>()),
  useOwnAccount: () => state.account,
}))
// The menu shows its trigger, header and each choice's label, which is what a person reads.
vi.mock('../src/Menu', () => ({
  Menu: ({
    label,
    icon,
    header,
    items,
  }: {
    label: string
    icon: ReactNode
    header: ReactNode
    items: { key: string; label?: ReactNode }[]
  }) =>
    createElement(
      'div',
      { 'aria-label': label },
      icon,
      header,
      items.map((item) => createElement(Fragment, { key: item.key }, '|', item.label)),
    ),
}))

const { AccountMenuButton } = await import('../src/sidebar/AccountMenuButton')
const { AccountProfileHeader } = await import('../src/settings/AccountProfile')

const user: AccountUser = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: 'https://avatars.githubusercontent.com/u/1?v=4',
}
const status = (signedIn: boolean): AccountStatus => ({
  signedIn,
  user: signedIn ? user : null,
  providers: signedIn ? ['github'] : [],
  backup: { account: false, github: false, lastBackupAt: null, error: null, hasKey: false },
  listed: false,
  trust: 'owner',
  pendingSignIn: null,
})

describe('the account at the foot of the rail', () => {
  it('stays a plain Settings button when signed out, without asking to sign in', () => {
    state.account = status(false)
    const html = renderToStaticMarkup(createElement(AccountMenuButton, { onOpen: () => {} }))
    expect(html).toContain('aria-label="Settings"')
    expect(html).not.toMatch(/Sign in|Ramu account/)
  })

  it('shows the signed-in picture above Settings, its menu naming who it is and opening the account', () => {
    state.account = status(true)
    const html = renderToStaticMarkup(createElement(AccountMenuButton, { onOpen: () => {} }))
    expect(html).toContain(`data-avatar="${user.image}"`)
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('ada@example.com')
    expect(html).toMatch(/aria-label="Ramu account"[\s\S]*aria-label="Settings"/)
  })
})

describe('the profile header in Settings', () => {
  it('names the provider the account was made with, beside its mark', () => {
    const html = renderToStaticMarkup(createElement(AccountProfileHeader, { user, providers: ['github', 'google'] }))
    expect(html).toContain('Signed in with GitHub')
    expect(html).toContain('data-brand="github"')
    expect(html).toContain('ada@example.com')
    const google = renderToStaticMarkup(createElement(AccountProfileHeader, { user, providers: ['google'] }))
    expect(google).toContain('Signed in with Google')
    expect(google).toContain('data-brand="google"')
  })

  it('leaves out the provider line until the host knows it, and falls back to the email without a name', () => {
    const html = renderToStaticMarkup(
      createElement(AccountProfileHeader, { user: { ...user, name: '', image: null }, providers: [] }),
    )
    expect(html).not.toContain('Signed in with')
    expect(html).toContain('data-avatar="initials"')
    expect(html.match(/ada@example\.com/g)).toHaveLength(2)
  })
})
