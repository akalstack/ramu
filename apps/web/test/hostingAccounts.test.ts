import { expect, it, vi } from 'vitest'
import { connectionHeadline } from '../src/settings/hostingStatus'

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
  expect(connectionHeadline({ cli: 'no-cli', accounts: [], checkedAt: 1 }, false)).toContain('not installed')
  expect(connectionHeadline({ cli: 'signed-out', accounts: [], checkedAt: 1 }, false)).toContain('Not signed in')
  expect(connectionHeadline({ cli: 'signed-in', accounts: [account()], checkedAt: 1 }, false)).toBe(
    'Connected as me on github.com (GitHub CLI)',
  )
})

it('prefers the in-use account, and reports an expired sign-in instead of a connection', () => {
  const summary = (accounts: ReturnType<typeof account>[]) => ({ cli: 'signed-in' as const, accounts, checkedAt: 1 })
  expect(
    connectionHeadline(summary([account({ login: 'other', active: false }), account({ login: 'me' })]), false),
  ).toContain('as me')
  expect(connectionHeadline(summary([account({ state: 'invalid' })]), false)).toContain('expired')
})
