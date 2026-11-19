// Domain names: which registered domain a host name belongs to, for the DNS zone of a lasting address.

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

/** The registered domain a host name belongs to. */
export function apexOf(host: string): string {
  const labels = host.split('.')
  const keep = SHARED_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2
  return labels.slice(-keep).join('.')
}
