// Grafana as a named service a Dashboard artifact reads: the person's Grafana address and a service account token
// (Viewer role), saved together as `https://grafana.example.com|glsa_…` in the host's credential store. Ramu calls
// only two read endpoints on that address: `/api/search` to check the token, and `/api/ds/query` to run the query a
// dashboard's table names. Nothing is written to Grafana.
import { platformCall, type HostingAuth } from '../workspace/deploy/adapter'

type Cell = string | number | null

/** What a dashboard's table asks Grafana for. */
export interface GrafanaQuery {
  /** The data source's uid, from its page in Grafana. */
  datasource: string
  /** The data source's own query fields, such as `expr` for Prometheus or `rawSql` and `format` for SQL. */
  query: Record<string, string | number | boolean>
  from?: string
  to?: string
}

interface Frame {
  schema?: { fields?: { name: string }[] }
  data?: { values?: unknown[][] }
}

/** The address and token from a saved `address|token`, the address an https origin (or loopback for tests). */
export function grafanaAuth(auth: HostingAuth): { origin: string; token: string } {
  const separator = auth.token.lastIndexOf('|')
  const address = separator > 0 ? auth.token.slice(0, separator) : ''
  const token = separator > 0 ? auth.token.slice(separator + 1) : ''
  let url: URL | null
  try {
    url = new URL(address)
  } catch {
    url = null
  }
  const loopback = url?.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (!url || !token || (url.protocol !== 'https:' && !loopback))
    throw new Error(
      'Save Grafana as its https address and a service account token joined by |, such as https://acme.grafana.net|glsa_….',
    )
  return { origin: url.origin, token }
}

const cell = (value: unknown): Cell =>
  value === null || value === undefined
    ? null
    : typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? value.slice(0, 200)
        : JSON.stringify(value).slice(0, 200)

export function grafanaConnector(options: { fetch?: typeof fetch } = {}) {
  const fetcher = options.fetch ?? fetch
  const call = <T>(auth: HostingAuth, path: string, what: string, init: RequestInit = {}) => {
    const { origin, token } = grafanaAuth(auth)
    return platformCall<T>('Grafana', fetcher, `${origin}${path}`, { ...init, token }, what)
  }
  return {
    name: 'Grafana',
    tokenPage: 'https://grafana.com/docs/grafana/latest/administration/service-accounts/',
    kind: 'service' as const,
    async account(auth: HostingAuth) {
      await call(auth, '/api/search?limit=1', 'checking the token')
      const { origin } = grafanaAuth(auth)
      return { id: origin, name: new URL(origin).host, defaultScope: null, broadScope: null, expiresAt: null }
    },
    /** Runs the query and returns its first frame's columns, in the order `columns` names them, at most `limit` rows. */
    async query(auth: HostingAuth, spec: GrafanaQuery, columns: string[], limit: number): Promise<Cell[][]> {
      const reply = await call<{ results?: Record<string, { frames?: Frame[]; error?: string }> }>(
        auth,
        '/api/ds/query',
        'running the query',
        {
          method: 'POST',
          body: JSON.stringify({
            from: spec.from ?? 'now-24h',
            to: spec.to ?? 'now',
            queries: [{ refId: 'A', datasource: { uid: spec.datasource }, ...spec.query }],
          }),
        },
      )
      const result = reply.results?.A
      if (result?.error) throw new Error(`Grafana could not run the query: ${result.error.slice(0, 200)}`)
      const frame = result?.frames?.[0]
      const names = frame?.schema?.fields?.map((field) => field.name) ?? []
      const values = frame?.data?.values ?? []
      const at = columns.map((column) => names.indexOf(column))
      const count = Math.min(limit, Math.max(0, ...values.map((column) => column.length)))
      return Array.from({ length: count }, (_, row) =>
        at.map((index) => (index < 0 ? null : cell(values[index]?.[row]))),
      )
    },
  }
}

export const grafana = grafanaConnector()
