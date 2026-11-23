// The Cloudflare API calls the relay makes: remotely managed tunnels, their ingress and token, a CNAME per host, and a
// traffic count. `fetch` is injected so the handler can be tested without the network.
import type { ListedTunnel } from './pool'

const API = 'https://api.cloudflare.com/client/v4'
/** Pages of tunnels one sweep reads, at most; Cloudflare allows 1,000 tunnels, so ten pages of 100 cover them. */
const MAX_PAGES = 10

export interface CloudflareConfig {
  token: string
  accountId: string
  zoneId: string
  fetch: typeof fetch
}

export interface Cloudflare {
  createTunnel(name: string): Promise<string>
  putIngress(tunnelId: string, ingress: unknown[]): Promise<void>
  tunnelToken(tunnelId: string): Promise<string>
  deleteTunnel(tunnelId: string): Promise<void>
  /** Creates the CNAME, or points the existing one at a new tunnel; returns the record id. */
  putCname(name: string, target: string, recordId: string | null): Promise<string>
  deleteRecord(recordId: string): Promise<void>
  listTunnels(prefix: string, deadline: number): Promise<ListedTunnel[]>
  /** Bytes served per hostname between two instants; empty when the dataset is unavailable on this plan. */
  bytesByHost(hostnames: string[], from: number, to: number): Promise<Map<string, number>>
}

interface Envelope<T> {
  success: boolean
  errors?: { code: number; message: string }[]
  result: T
  result_info?: { page: number; total_pages: number }
}

export class CloudflareError extends Error {}

export function cloudflare(config: CloudflareConfig): Cloudflare {
  // Called on its own, never as `config.fetch(...)`: the Workers runtime's fetch throws "Illegal invocation" when it is
  // called with any other object as `this`.
  const send = config.fetch
  const call = async <T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> => {
    const response = await send(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const envelope = (await response.json().catch(() => null)) as Envelope<T> | null
    if (!response.ok || !envelope?.success)
      throw new CloudflareError(envelope?.errors?.[0]?.message ?? `Cloudflare answered ${response.status}`)
    return envelope
  }
  const account = `/accounts/${config.accountId}`
  const zone = `/zones/${config.zoneId}`
  return {
    async createTunnel(name) {
      return (await call<{ id: string }>('POST', `${account}/cfd_tunnel`, { name, config_src: 'cloudflare' })).result.id
    },
    async putIngress(tunnelId, ingress) {
      await call('PUT', `${account}/cfd_tunnel/${tunnelId}/configurations`, { config: { ingress } })
    },
    async tunnelToken(tunnelId) {
      return (await call<string>('GET', `${account}/cfd_tunnel/${tunnelId}/token`)).result
    },
    async deleteTunnel(tunnelId) {
      // A tunnel with live connections cannot be deleted; clearing them first lets a running host be cut off.
      await call('DELETE', `${account}/cfd_tunnel/${tunnelId}/connections`).catch(() => undefined)
      try {
        await call('DELETE', `${account}/cfd_tunnel/${tunnelId}`)
      } catch (error) {
        if (!/not found|does not exist/i.test(String((error as Error).message))) throw error
      }
    },
    async putCname(name, target, recordId) {
      const record = { type: 'CNAME', name, content: target, proxied: true, ttl: 1 }
      if (recordId) {
        try {
          return (await call<{ id: string }>('PATCH', `${zone}/dns_records/${recordId}`, record)).result.id
        } catch {
          // The record was removed by hand; make it again.
        }
      }
      try {
        return (await call<{ id: string }>('POST', `${zone}/dns_records`, record)).result.id
      } catch (error) {
        // A record left by a removal that did not go through: take it over rather than failing on the name.
        const found = await call<{ id: string }[]>(
          'GET',
          `${zone}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
        ).catch(() => null)
        const existing = found?.result[0]?.id
        if (!existing) throw error
        return (await call<{ id: string }>('PATCH', `${zone}/dns_records/${existing}`, record)).result.id
      }
    },
    async deleteRecord(recordId) {
      await call('DELETE', `${zone}/dns_records/${recordId}`).catch(() => undefined)
    },
    async listTunnels(prefix, deadline) {
      const tunnels: ListedTunnel[] = []
      for (let page = 1; page <= MAX_PAGES && Date.now() < deadline; page++) {
        const envelope = await call<
          { id: string; name: string; status: string; created_at: string; conns_active_at: string | null }[]
        >('GET', `${account}/cfd_tunnel?is_deleted=false&per_page=100&page=${page}&name=${encodeURIComponent(prefix)}`)
        for (const tunnel of envelope.result)
          tunnels.push({
            id: tunnel.id,
            name: tunnel.name,
            status: tunnel.status,
            createdAt: Date.parse(tunnel.created_at),
            connectedAt: tunnel.conns_active_at ? Date.parse(tunnel.conns_active_at) : null,
          })
        if (!envelope.result_info || page >= envelope.result_info.total_pages) break
      }
      return tunnels
    },
    async bytesByHost(hostnames, from, to) {
      const counts = new Map<string, number>()
      if (!hostnames.length) return counts
      const query = `query ($zone: String!, $from: Time!, $to: Time!, $hosts: [String!]) {
        viewer { zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $from, datetime_lt: $to, clientRequestHTTPHost_in: $hosts }) {
            sum { edgeResponseBytes }
            dimensions { clientRequestHTTPHost }
          }
        } }
      }`
      const response = await send(`${API}/graphql`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: {
            zone: config.zoneId,
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString(),
            hosts: hostnames,
          },
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        data?: {
          viewer?: {
            zones?: {
              httpRequestsAdaptiveGroups?: {
                sum: { edgeResponseBytes: number }
                dimensions: { clientRequestHTTPHost: string }
              }[]
            }[]
          }
        }
      } | null
      for (const group of data?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []) {
        const host = group.dimensions.clientRequestHTTPHost
        counts.set(host, (counts.get(host) ?? 0) + group.sum.edgeResponseBytes)
      }
      return counts
    },
  }
}
