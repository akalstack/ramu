// Amplitude as a named service a Dashboard artifact reads: a project's API key and secret key, saved together as
// `api_key:secret_key` (or `eu|api_key:secret_key` for a project in Amplitude's EU data center) in the host's
// credential store. Ramu calls only two read endpoints of the Dashboard REST API: the event list to check the keys,
// and event segmentation for the event a dashboard's table names. Nothing is written to Amplitude.
import { platformCall, type HostingAuth } from '../workspace/deploy/adapter'

type Cell = string | number | null

/** What a dashboard's table asks Amplitude for. */
export interface AmplitudeQuery {
  event: string
  /** uniques (the default), totals, pct_dau or average. */
  metric?: 'uniques' | 'totals' | 'pct_dau' | 'average'
  /** How many days back from today, today included; 30 when absent. */
  days?: number
  /** 1 for daily (the default), 7 weekly, 30 monthly. */
  interval?: 1 | 7 | 30
}

/** The API origin and Basic credentials from a saved `[eu|]api_key:secret_key`. */
export function amplitudeAuth(auth: HostingAuth): { origin: string; basic: string } {
  const eu = auth.token.startsWith('eu|')
  const keys = eu ? auth.token.slice(3) : auth.token
  const separator = keys.indexOf(':')
  if (separator < 1 || separator === keys.length - 1)
    throw new Error(
      'Save Amplitude as the project’s API key and secret key joined by a colon (key:secret), with eu| before them for an EU project.',
    )
  return {
    origin: eu ? 'https://analytics.eu.amplitude.com' : 'https://amplitude.com',
    basic: `Basic ${Buffer.from(keys).toString('base64')}`,
  }
}

const day = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '')

export function amplitudeConnector(options: { fetch?: typeof fetch; origin?: string; now?: () => Date } = {}) {
  const fetcher = options.fetch ?? fetch
  const now = options.now ?? (() => new Date())
  const call = <T>(auth: HostingAuth, path: string, what: string) => {
    const { origin, basic } = amplitudeAuth(auth)
    return platformCall<T>(
      'Amplitude',
      fetcher,
      `${options.origin ?? origin}${path}`,
      { token: '', headers: { Authorization: basic } },
      what,
    )
  }
  return {
    name: 'Amplitude',
    tokenPage: 'https://app.amplitude.com/analytics/settings/projects',
    kind: 'service' as const,
    async account(auth: HostingAuth) {
      await call(auth, '/api/2/events/list', 'checking the keys')
      const { origin } = amplitudeAuth(auth)
      const key = auth.token.replace(/^eu\|/, '').split(':')[0]!
      return {
        id: `${origin}:${key}`,
        name: `Amplitude project ${key.slice(0, 6)}…`,
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    /** One row per date and series, as `date`, `series` and `value` in the order `columns` names them. */
    async query(auth: HostingAuth, spec: AmplitudeQuery, columns: string[], limit: number): Promise<Cell[][]> {
      const days = Math.min(365, Math.max(1, spec.days ?? 30))
      const end = now()
      const start = new Date(end.getTime() - (days - 1) * 86_400_000)
      const params = new URLSearchParams({
        e: JSON.stringify({ event_type: spec.event }),
        start: day(start),
        end: day(end),
        m: spec.metric ?? 'uniques',
        i: String(spec.interval ?? 1),
      })
      const { data } = await call<{
        data?: { series?: number[][]; xValues?: string[]; seriesLabels?: unknown[] }
      }>(auth, `/api/2/events/segmentation?${params.toString()}`, 'reading the event')
      const rows: Cell[][] = []
      for (const [index, series] of (data?.series ?? []).entries()) {
        const label = data?.seriesLabels?.[index]
        const name = label === undefined || label === 0 ? spec.event : String(label).slice(0, 200)
        for (const [at, value] of series.entries()) {
          const fields: Record<string, Cell> = { date: data?.xValues?.[at] ?? null, series: name, value }
          rows.push(columns.map((column) => fields[column] ?? null))
          if (rows.length >= limit) return rows
        }
      }
      return rows
    },
  }
}

export const amplitude = amplitudeConnector()
