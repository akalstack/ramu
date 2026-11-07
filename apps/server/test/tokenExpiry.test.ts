import { expect, it, vi } from 'vitest'
import type { HostingAccount } from '@ramu/shared/types/deploy'
import { TokenExpiryNotices } from '../src/workspace/deploy/tokenExpiry'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-07T09:00:00Z')

function setup(expiresAt: number | null) {
  const state = new Map<string, unknown>()
  const raise = vi.fn()
  const account = { platform: 'vercel', name: 'Vercel', connected: true, expiresAt } as HostingAccount
  const notices = new TokenExpiryNotices({
    getState: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
    setState: (key, value) => void state.set(key, value),
    accounts: async () => [account],
    projects: () => [
      { id: 'shop', name: 'Shop' },
      { id: 'blog', name: 'Blog' },
      { id: 'quiet', name: 'Quiet' },
    ],
    platformOf: (id) => (id === 'blog' ? 'netlify' : 'vercel'),
    latestThread: (id) => (id === 'quiet' ? null : { taskId: `t-${id}`, sessionId: `s-${id}` }),
    raise,
  })
  return { notices, raise, account }
}

it('tells each project deploying with a token a week before it expires, once per saved token', async () => {
  const { notices, raise, account } = setup(NOW + 3 * DAY)
  await notices.tick(NOW)
  expect(raise).toHaveBeenCalledTimes(1)
  expect(raise.mock.calls[0]![0]).toMatchObject({
    id: 'token:vercel:shop',
    taskId: 't-shop',
    sessionId: 's-shop',
    kind: 'usage',
    title: 'Vercel token expires in 3 days',
  })
  expect(raise.mock.calls[0]![0].body).toContain('Settings → Git → Hosting accounts')
  await notices.tick(NOW + 7 * 60 * 60_000)
  expect(raise).toHaveBeenCalledTimes(1)
  // A replaced token has a new date, told again when it nears.
  account.expiresAt = NOW + 40 * DAY
  await notices.tick(NOW + 14 * 60 * 60_000)
  expect(raise).toHaveBeenCalledTimes(1)
  await notices.tick(NOW + 35 * DAY)
  expect(raise).toHaveBeenCalledTimes(2)
})

it('says a token has expired, and stays quiet for tokens that do not expire or are far off', async () => {
  const expired = setup(NOW - DAY)
  await expired.notices.tick(NOW)
  expect(expired.raise.mock.calls[0]![0].title).toBe('Vercel token has expired')
  for (const at of [null, NOW + 30 * DAY]) {
    const quiet = setup(at)
    await quiet.notices.tick(NOW)
    expect(quiet.raise).not.toHaveBeenCalled()
  }
})
