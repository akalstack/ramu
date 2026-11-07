// What the service checks itself when a platform does not report a domain's state: whether public DNS answers a record,
// and whether the domain serves HTTPS with a valid certificate. Tests replace both, so no test resolves real names.
import { Resolver } from 'node:dns/promises'
import type { DnsRecord } from '@ramu/shared/types/deploy'

export interface DomainProbes {
  /** Whether public DNS already answers the record. */
  resolves(record: DnsRecord): Promise<boolean>
  /** Whether the domain completes an HTTPS request with a certificate the system trusts. */
  https(name: string): Promise<boolean>
}

const host = (value: string) => value.toLowerCase().replace(/\.$/, '')

export const liveProbes: DomainProbes = {
  async resolves(record) {
    const resolver = new Resolver({ timeout: 5_000, tries: 2 })
    try {
      if (record.type === 'CNAME')
        return (await resolver.resolveCname(record.host)).map(host).includes(host(record.value))
      if (record.type === 'A') return (await resolver.resolve4(record.host)).includes(record.value)
      return (await resolver.resolveTxt(record.host)).some((parts) => parts.join('') === record.value)
    } catch {
      return false
    }
  },
  async https(name) {
    // Only the handshake matters: the body is never read and redirects are not followed.
    try {
      const response = await fetch(`https://${name}/`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      await response.body?.cancel()
      return true
    } catch {
      return false
    }
  },
}
