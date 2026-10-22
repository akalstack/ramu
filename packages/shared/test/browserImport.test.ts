import { describe, expect, it } from 'vitest'
import {
  SKIP_REASONS,
  importDomains,
  mergeSkips,
  selectCookies,
  siteOf,
  toElectronCookie,
  type ImportCookie,
} from '../src/browserImport'

const cookie = (over: Partial<ImportCookie> = {}): ImportCookie => ({
  name: 'sid',
  value: 'secret',
  host: '.example.com',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  expires: 4_000_000_000,
  ...over,
})

describe('siteOf', () => {
  it('groups subdomains under their site, including two-label suffixes', () => {
    expect(siteOf('accounts.google.com')).toBe('google.com')
    expect(siteOf('.mail.google.com')).toBe('google.com')
    expect(siteOf('news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOf('shop.tokopedia.co.id')).toBe('tokopedia.co.id')
    expect(siteOf('localhost')).toBe('localhost')
    expect(siteOf('192.168.1.5')).toBe('192.168.1.5')
  })
})

describe('importDomains', () => {
  it('counts cookies per site, most first, and ignores partitioned ones', () => {
    const list = importDomains([
      cookie({ host: '.a.example.com' }),
      cookie({ host: 'b.example.com' }),
      cookie({ host: '.other.org' }),
      cookie({ host: '.tracker.net', partitioned: true }),
    ])
    expect(list).toEqual([
      { domain: 'example.com', cookies: 2 },
      { domain: 'other.org', cookies: 1 },
    ])
  })
})

describe('selectCookies', () => {
  const now = 1_700_000_000_000
  it('selects nothing unless a site is chosen', () => {
    expect(selectCookies([cookie()], [], now)).toEqual({ cookies: [], skipped: [] })
  })

  it('keeps only the chosen sites and never moves a cookie to a sibling or parent host', () => {
    const picked = selectCookies(
      [
        cookie({ host: 'a.example.com' }),
        cookie({ host: '.example.com' }),
        cookie({ host: '.evil-example.com' }),
        cookie({ host: 'example.com.evil.net' }),
      ],
      ['example.com'],
      now,
    )
    expect(picked.cookies.map((entry) => entry.host)).toEqual(['a.example.com', '.example.com'])
  })

  it('reports why cookies of a chosen site were left behind', () => {
    const picked = selectCookies(
      [
        cookie(),
        cookie({ name: 'old', expires: 1_000_000_000 }),
        cookie({ name: 'part', partitioned: true }),
        cookie({ name: 'bad name', value: 'x' }),
        cookie({ name: 'inj', value: 'a;b' }),
      ],
      ['example.com'],
      now,
    )
    expect(picked.cookies).toHaveLength(1)
    expect(picked.skipped).toEqual(
      expect.arrayContaining([
        { reason: SKIP_REASONS.expired, count: 1 },
        { reason: SKIP_REASONS.partitioned, count: 1 },
        { reason: SKIP_REASONS.invalid, count: 2 },
      ]),
    )
  })

  it('keeps session cookies', () => {
    expect(selectCookies([cookie({ expires: undefined })], ['example.com'], now).cookies).toHaveLength(1)
  })
})

describe('toElectronCookie', () => {
  it('keeps a host-only cookie host-only and gives a domain cookie a domain', () => {
    const hostOnly = toElectronCookie(cookie({ host: 'app.example.com', secure: false }))
    expect(hostOnly.domain).toBeUndefined()
    expect(hostOnly.url).toBe('http://app.example.com/')
    const wide = toElectronCookie(cookie({ host: '.example.com', path: '/account' }))
    expect(wide.domain).toBe('.example.com')
    expect(wide.url).toBe('https://example.com/account')
    expect(wide).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 4_000_000_000 })
  })

  it('omits an expiry for a session cookie', () => {
    expect('expirationDate' in toElectronCookie(cookie({ expires: undefined }))).toBe(false)
  })
})

describe('mergeSkips', () => {
  it('adds up the same reason across steps', () => {
    expect(
      mergeSkips(
        [{ reason: 'a', count: 1 }],
        [
          { reason: 'a', count: 2 },
          { reason: 'b', count: 1 },
        ],
      ),
    ).toEqual([
      { reason: 'a', count: 3 },
      { reason: 'b', count: 1 },
    ])
  })
})
