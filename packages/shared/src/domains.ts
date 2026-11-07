// Custom domain names: checking what a person typed, and naming DNS records the way DNS providers ask for them.

/** A lowercase host name with at least two labels, such as `www.example.com`. */
export const DOMAIN_NAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/

/** What a person typed (perhaps with `https://` or a trailing slash) as a bare host name, or null when it is not one. */
export function domainName(input: string): string | null {
  const name = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
  return DOMAIN_NAME.test(name) ? name : null
}

/** Second-level registrations sold like top-level ones, so `shop.co.id` is a domain of its own and not `co.id`'s. */
const SHARED_SUFFIXES = new Set([
  'co.id',
  'or.id',
  'ac.id',
  'web.id',
  'my.id',
  'biz.id',
  'co.uk',
  'org.uk',
  'com.au',
  'net.au',
  'co.nz',
  'co.jp',
  'com.br',
  'co.in',
  'com.sg',
  'com.my',
])

/** The registered domain a host name belongs to, when the platform does not say. */
export function apexOf(host: string): string {
  const labels = host.split('.')
  const keep = SHARED_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2
  return labels.slice(-keep).join('.')
}

/** A host name relative to its zone: `@` for the zone itself. */
export function recordName(host: string, apex: string): string {
  if (host === apex) return '@'
  return host.endsWith(`.${apex}`) ? host.slice(0, -apex.length - 1) : host
}
