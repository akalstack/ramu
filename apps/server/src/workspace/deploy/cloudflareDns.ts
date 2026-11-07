// Creating a domain's records at Cloudflare DNS with a token the person pastes for this one action: the records the
// platform asks for are added (or corrected) in the domain's zone, unproxied so the platform can verify them and serve
// its own certificate, and the token is not kept.
import { apexOf } from '@ramu/shared/domains'
import type { DnsRecord } from '@ramu/shared/types/deploy'
import { platformCall } from './adapter'

export async function createCloudflareRecords(
  token: string,
  domain: string,
  records: DnsRecord[],
  options: { api?: string; fetch?: typeof fetch } = {},
): Promise<number> {
  const api = options.api ?? 'https://api.cloudflare.com/client/v4'
  const call = <T>(path: string, what: string, init: RequestInit = {}) =>
    platformCall<{ result: T }>('Cloudflare', options.fetch ?? fetch, `${api}${path}`, { ...init, token }, what).then(
      (reply) => reply.result,
    )
  const zoneName = apexOf(domain)
  const [zone] = await call<{ id: string }[]>(`/zones?name=${encodeURIComponent(zoneName)}`, 'finding the domain')
  if (!zone) throw new Error(`${zoneName} is not a domain on this Cloudflare account, or the token cannot see it.`)
  let written = 0
  for (const record of records) {
    const existing = await call<{ id: string }[]>(
      `/zones/${zone.id}/dns_records?type=${record.type}&name=${encodeURIComponent(record.host)}`,
      'reading the DNS records',
    )
    const body = JSON.stringify({ type: record.type, name: record.host, content: record.value, ttl: 1, proxied: false })
    // A TXT record for ownership sits beside others of its name; an A or CNAME replaces the one there.
    const replace = record.type !== 'TXT' ? existing[0] : undefined
    if (replace)
      await call(`/zones/${zone.id}/dns_records/${replace.id}`, 'updating a DNS record', { method: 'PUT', body })
    else await call(`/zones/${zone.id}/dns_records`, 'adding a DNS record', { method: 'POST', body })
    written++
  }
  return written
}
