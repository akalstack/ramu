import { describe, expect, it, vi } from 'vitest'
import type { InboxNotice } from '@ramu/shared/chat/notices'
import type { UsageReport } from '@ramu/shared/types/deploy'
import { DeployError } from '../src/workspace/deploy/adapter'
import { UsageNotices, usageReport } from '../src/workspace/deploy/usage'

describe('usage reports', () => {
  it('says so in plain words when a platform reports no usage, instead of inventing figures', async () => {
    expect((await usageReport('netlify', 'Netlify', undefined)).unavailable).toContain('reports no usage')
    const refused = await usageReport('vercel', 'Vercel', async () => {
      throw new DeployError('refused', 'missing-permission', 403)
    })
    expect(refused).toMatchObject({ figures: [], unavailable: expect.stringContaining('does not report usage') })
    const empty = await usageReport('netlify', 'Netlify', async () => ({
      period: null,
      figures: [],
      billingPage: 'https://app.netlify.com/',
    }))
    expect(empty.unavailable).toContain('no usage figures for this plan')
    const signedOut = await usageReport('neon', 'Neon', async () => {
      throw new DeployError('Neon refused the saved sign-in.', 'signed-out', 401)
    })
    expect(signedOut.unavailable).toBe('Neon refused the saved sign-in.')
    expect(signedOut.billingPage).toBe('https://console.neon.tech/app/billing')
  })
})

const report = (used: number, limit: number | null, start = Date.UTC(2026, 10, 1)): UsageReport => ({
  platform: 'netlify',
  name: 'Netlify',
  period: { start, end: null },
  figures: [{ metric: 'build-minutes', service: null, used, unit: 'minutes', limit }],
  unavailable: null,
  billingPage: 'https://app.netlify.com/teams/ana/billing/general',
})

function setup(reports: UsageReport[][]) {
  const state = new Map<string, unknown>()
  const raised: InboxNotice[] = []
  const notices = new UsageNotices(
    {
      getState: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
      setState: (key, value) => void state.set(key, value),
      projects: () => [{ id: 'p1', name: 'Shop' }],
      latestThread: () => ({ taskId: 't1', sessionId: 's1' }),
      raise: (notice) => void raised.push(notice),
    },
    vi.fn(async () => reports.shift() ?? []),
  )
  let now = Date.UTC(2026, 10, 7)
  const check = () => notices.tick((now += 7 * 60 * 60_000))
  return { raised, check }
}

describe('usage notices', () => {
  it('raises one notice at 80% and one at 100% per period, naming what grows and the cheapest fix', async () => {
    const { raised, check } = setup([
      [report(100, 300)],
      [report(250, 300)],
      [report(260, 300)],
      [report(300, 300)],
      [report(310, 300)],
      [report(250, 300, Date.UTC(2026, 11, 1))],
    ])
    for (let run = 0; run < 6; run++) await check()
    expect(raised.map((notice) => notice.title)).toEqual([
      'Shop: Netlify build minutes at 80%',
      'Shop: Netlify build minutes at 100%',
      'Shop: Netlify build minutes at 80%',
    ])
    expect(raised[0]).toMatchObject({ kind: 'usage', taskId: 't1', sessionId: 's1' })
    expect(raised[0]?.body).toContain('Cheapest fix: build only when')
    expect(raised[0]?.body).toContain('Ramu never changes it')
  })

  it('raises nothing for a figure whose limit the platform does not report', async () => {
    const { raised, check } = setup([[report(10_000, null)]])
    await check()
    expect(raised).toEqual([])
  })
})
