// Pure rules for copying website sign-ins once from another browser into a new Ramu profile. Nothing here reads a file,
// a keychain or a cookie store: readers hand over parsed cookies, and callers decide what to do with the outcome.
import type { BrowserImportDomain, BrowserImportResult, BrowserImportSkip } from './types/browser'

export type CookieSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict'

/** A cookie from a source browser, with the attributes that decide where it may be sent. */
export interface ImportCookie {
  name: string
  value: string
  /** As stored: `.example.com` applies to subdomains too, `example.com` is host-only. */
  host: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite
  /** Seconds since the Unix epoch. Absent for a session cookie. */
  expires?: number
  /** Cookies partitioned by a top-level site are not copied. */
  partitioned?: boolean
}

/** Why a cookie was left behind. These are the only reasons shown. */
export const SKIP_REASONS = {
  partitioned: 'Partitioned third-party cookies are not copied.',
  expired: 'Already expired.',
  undecryptable: 'Protected by the source browser and could not be read.',
  notSelected: 'Belongs to a website you did not select.',
  invalid: 'Not a valid cookie for this browser.',
} as const

// Public suffixes with two labels that matter for the sites people sign in to. This is a grouping aid for the list, never a
// security boundary: selection always compares whole host names.
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'co.kr',
  'co.in',
  'co.id',
  'or.id',
  'go.id',
  'ac.id',
  'web.id',
  'com.br',
  'com.mx',
  'com.ar',
  'com.tr',
  'com.sg',
  'com.my',
  'com.hk',
  'com.tw',
  'com.cn',
  'co.za',
])

const bareHost = (host: string) => host.replace(/^\./, '').toLowerCase()

/** The site a host belongs to, for grouping: `mail.google.com` and `accounts.google.com` are both `google.com`. */
export function siteOf(host: string): string {
  const labels = bareHost(host).split('.').filter(Boolean)
  if (labels.length <= 2 || /^\d+(\.\d+){3}$/.test(labels.join('.'))) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return labels.slice(TWO_LABEL_SUFFIXES.has(lastTwo) ? -3 : -2).join('.')
}

/** Websites with cookies, most cookies first. */
export function importDomains(cookies: readonly ImportCookie[]): BrowserImportDomain[] {
  const counts = new Map<string, number>()
  for (const cookie of cookies) {
    if (cookie.partitioned) continue
    const site = siteOf(cookie.host)
    counts.set(site, (counts.get(site) ?? 0) + 1)
  }
  return [...counts]
    .map(([domain, cookies]) => ({ domain, cookies }))
    .sort((a, b) => b.cookies - a.cookies || a.domain.localeCompare(b.domain))
}

export interface SelectedCookies {
  cookies: ImportCookie[]
  skipped: BrowserImportSkip[]
}

/**
 * Keeps cookies of the selected sites only. A cookie stays as narrow as it was: a host-only cookie stays host-only and a
 * cookie for `a.example.com` is never moved to `example.com` or a sibling. Nothing is selected unless asked for.
 */
export function selectCookies(
  cookies: readonly ImportCookie[],
  selected: readonly string[],
  now = Date.now(),
): SelectedCookies {
  const sites = new Set(selected.map((domain) => domain.toLowerCase()))
  const kept: ImportCookie[] = []
  const skipped = new Map<string, number>()
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  for (const cookie of cookies) {
    if (!sites.has(siteOf(cookie.host))) {
      // Cookies of sites that were not chosen are not "skipped" work: they were never part of the request.
      continue
    }
    if (cookie.partitioned) skip(SKIP_REASONS.partitioned)
    else if (cookie.expires !== undefined && cookie.expires * 1000 <= now) skip(SKIP_REASONS.expired)
    else if (!validCookie(cookie)) skip(SKIP_REASONS.invalid)
    else kept.push(cookie)
  }
  return { cookies: kept, skipped: [...skipped].map(([reason, count]) => ({ reason, count })) }
}

function validCookie(cookie: ImportCookie): boolean {
  return (
    /^[^\s;=,"]+$/.test(cookie.name) &&
    !/[\r\n;]/.test(cookie.value) &&
    /^\.?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(cookie.host) &&
    cookie.path.startsWith('/') &&
    cookie.name.length <= 4096 &&
    cookie.value.length <= 4096
  )
}

/** The arguments Electron's `cookies.set` needs: a URL that matches the host, and a domain only where the cookie had one. */
export interface ElectronCookie {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite
  expirationDate?: number
}

export function toElectronCookie(cookie: ImportCookie): ElectronCookie {
  const hostOnly = !cookie.host.startsWith('.')
  const host = bareHost(cookie.host)
  return {
    // A secure cookie needs an https URL; the host and path decide where it applies.
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
    name: cookie.name,
    value: cookie.value,
    // Host-only cookies carry no domain, so they are not widened to subdomains.
    ...(hostOnly ? {} : { domain: `.${host}` }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    ...(cookie.expires !== undefined ? { expirationDate: cookie.expires } : {}),
  }
}

export const emptyImportResult = (): BrowserImportResult => ({ imported: 0, skipped: [], failed: 0 })

/** Combines skip reasons from several steps into one list. */
export function mergeSkips(...lists: BrowserImportSkip[][]): BrowserImportSkip[] {
  const merged = new Map<string, number>()
  for (const list of lists) for (const { reason, count } of list) merged.set(reason, (merged.get(reason) ?? 0) + count)
  return [...merged].map(([reason, count]) => ({ reason, count }))
}
