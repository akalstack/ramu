import { expect, it, vi } from 'vitest'
import { accessLines, connectionHeadline, publishAccount } from '../src/settings/hostingStatus'

vi.mock('../src/i18n', () => ({
  t: (value: string, args: Record<string, string> = {}) =>
    value.replace(/\{(\w+)\}/g, (_, key: string) => args[key] ?? `{${key}}`),
}))

const account = (patch = {}) => ({
  host: 'github.com',
  login: 'me',
  active: true,
  state: 'ok' as const,
  protocol: 'ssh',
  scopes: [],
  ...patch,
})

it('says what is known and never claims a connection it has not seen', () => {
  expect(connectionHeadline(null, false)).toBe('Checking…')
  expect(connectionHeadline(null, true)).toContain('Could not check')
  expect(connectionHeadline({ cli: 'no-cli', accounts: [], saved: [], checkedAt: 1 }, false)).toContain('not installed')
  expect(connectionHeadline({ cli: 'signed-out', accounts: [], saved: [], checkedAt: 1 }, false)).toContain(
    'Not signed in',
  )
  expect(connectionHeadline({ cli: 'signed-in', accounts: [account()], saved: [], checkedAt: 1 }, false)).toBe(
    'Connected as me on github.com (GitHub CLI)',
  )
})

it('prefers the in-use account, and reports an expired sign-in instead of a connection', () => {
  const summary = (accounts: ReturnType<typeof account>[]) => ({
    cli: 'signed-in' as const,
    accounts,
    saved: [],
    checkedAt: 1,
  })
  expect(
    connectionHeadline(summary([account({ login: 'other', active: false }), account({ login: 'me' })]), false),
  ).toContain('as me')
  expect(connectionHeadline(summary([account({ state: 'invalid' })]), false)).toContain('expired')
})

it('names who a new repository is published as, and nothing when no sign-in works', () => {
  const summary = (accounts: ReturnType<typeof account>[]) => ({
    cli: 'signed-in' as const,
    accounts,
    saved: [],
    checkedAt: 1,
  })
  expect(publishAccount(summary([account({ login: 'me' })]))).toBe('Publishing as me on github.com')
  expect(publishAccount(summary([account({ state: 'invalid' })]))).toBeNull()
})

it('reports API reads, writes and transport on separate lines', () => {
  const lines = accessLines({
    origin: 'github.com',
    account: { source: 'saved', login: 'me', connectionId: 'c', ambiguous: false },
    api: { read: { state: 'ok', detail: null }, write: { state: 'denied', detail: 'No push' } },
    transport: { state: 'failed', detail: 'Permission denied (publickey)' },
    checkedAt: 1,
  })
  expect(lines.map((line) => line.text)).toEqual([
    'Saved token for me',
    'Works',
    'Not allowed: No push',
    'Failed: Permission denied (publickey)',
  ])
})
