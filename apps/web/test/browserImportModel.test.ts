import { describe, expect, it } from 'vitest'
import {
  canImport,
  defaultImportName,
  resultLines,
  selectedCookieCount,
  toggleDomain,
  matchingDomains,
  toggleAll,
} from '../src/settings/browserImportModel'

const profile = (name: string) => ({ id: name, name, builtin: false, temporary: false, createdAt: 1 })

it('suggests an unused name from the source and profile', () => {
  expect(defaultImportName('Google Chrome', 'Default', [])).toBe('From Google Chrome')
  expect(defaultImportName('Google Chrome', 'Work', [])).toBe('From Google Chrome · Work')
  expect(defaultImportName('Firefox', 'default-release', [profile('from firefox')])).toBe('From Firefox 2')
  expect(defaultImportName('Firefox', '', [profile('From Firefox'), profile('From Firefox 2')])).toBe('From Firefox 3')
  expect(defaultImportName('x'.repeat(200), '', []).length).toBeLessThanOrEqual(80)
})

it('preselects nothing and needs a site and a name', () => {
  expect(canImport(new Set(), 'Name')).toBe(false)
  expect(canImport(new Set(['a.com']), '   ')).toBe(false)
  expect(canImport(new Set(['a.com']), 'x'.repeat(81))).toBe(false)
  expect(canImport(new Set(['a.com']), 'From Chrome')).toBe(true)
})

it('toggles sites without changing the original selection', () => {
  const none = new Set<string>()
  const one = toggleDomain(none, 'a.com')
  expect([...one]).toEqual(['a.com'])
  expect(none.size).toBe(0)
  expect(toggleDomain(one, 'a.com').size).toBe(0)
})

it('counts the cookies of the selected sites', () => {
  const domains = [
    { domain: 'a.com', cookies: 3 },
    { domain: 'b.com', cookies: 5 },
  ]
  expect(selectedCookieCount(domains, new Set(['b.com']))).toBe(5)
  expect(selectedCookieCount(domains, new Set())).toBe(0)
})

it('describes the result with exact counts and reasons', () => {
  expect(resultLines({ imported: 1, skipped: [], failed: 0 })).toEqual(['Copied 1 sign-in cookie.'])
  expect(resultLines({ imported: 4, skipped: [{ reason: 'Already expired.', count: 2 }], failed: 1 })).toEqual([
    'Copied 4 sign-in cookies.',
    'Skipped 2: Already expired.',
    '1 could not be saved.',
  ])
})

describe('choosing websites in a long list', () => {
  const domains = [
    { domain: 'google.com', cookies: 141 },
    { domain: 'meshy.ai', cookies: 43 },
    { domain: 'docs.google.com', cookies: 3 },
  ]

  it('searches by address, ignoring case and outer spaces', () => {
    expect(matchingDomains(domains, ' GOOGLE ').map((entry) => entry.domain)).toEqual(['google.com', 'docs.google.com'])
    expect(matchingDomains(domains, '')).toHaveLength(3)
  })

  it('selects what the search shows, keeps other picks, and clears them once all are picked', () => {
    const shown = matchingDomains(domains, 'google')
    const picked = toggleAll(new Set(['meshy.ai']), shown)
    expect([...picked].sort()).toEqual(['docs.google.com', 'google.com', 'meshy.ai'])
    expect([...toggleAll(picked, shown)]).toEqual(['meshy.ai'])
  })
})
