import type { AgentProvider, UsageReading } from './types'

// A login's percentage is the same quota seen from every host, so percentages never add up: each login appears once,
// with its newest reading. Account ids are local to a host; only a sign-in email matches a login across hosts.

export interface HostUsage {
  hostId: string
  host: string
  readings: readonly UsageReading[]
  /** Sign-in email per provider and local account id, where the host knows it. */
  emails: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface LoginUsage {
  provider: AgentProvider
  /** The sign-in email, or null for a login that could not be matched and is listed by host. */
  email: string | null
  hosts: string[]
  readings: UsageReading[]
}

export function loginsAcrossHosts(hosts: readonly HostUsage[]): LoginUsage[] {
  const logins = new Map<string, LoginUsage>()
  for (const { hostId, host, readings, emails } of hosts)
    for (const reading of readings) {
      const account = reading.accountId ?? 'default'
      const email = emails[reading.provider]?.[account]?.toLowerCase() ?? null
      const key = email ? `${reading.provider}\0${email}` : `${reading.provider}\0${hostId}\0${account}`
      const login = logins.get(key) ?? { provider: reading.provider, email, hosts: [], readings: [] }
      if (!login.hosts.includes(host)) login.hosts.push(host)
      const window = (entry: UsageReading) => `${entry.window}\0${entry.scope ?? ''}`
      const same = login.readings.findIndex((entry) => window(entry) === window(reading))
      if (same < 0) login.readings.push(reading)
      else if (login.readings[same]!.updatedAt < reading.updatedAt) login.readings[same] = reading
      logins.set(key, login)
    }
  return [...logins.values()]
}

/** The window that decides how close a login is to its limit. */
export const peakOf = (login: Pick<LoginUsage, 'readings'>) =>
  [...login.readings].sort((a, b) => b.usedPercent - a.usedPercent)[0]

/** One host's finished turns on one day for one provider; cost and tokens only where the provider reports them. */
export interface ActivityRow {
  day: string
  provider: AgentProvider
  turns: number
  costUsd: number
  /** Turns whose provider reported no cost; they are never counted as free. */
  unpriced: number
  /** Input and output tokens; absent from hosts that predate token counts. */
  tokens?: number
  /** Turns whose provider reported no tokens; never counted as zero. */
  untokened?: number
}

export interface ActivityTotal {
  turns: number
  costUsd: number
  tokens: number
  /** Hosts with turns their provider did not price. */
  unpricedOn: string[]
  /** Hosts with turns that reported no tokens, so the token total leaves them out. */
  untokenedOn: string[]
  /** Hosts that could not be read, so the totals leave them out. */
  missing: string[]
  byHost: { host: string; turns: number; costUsd: number; tokens: number }[]
}

/** Adds each host's own figures; a host that could not be read is named, never treated as zero. */
export function activityAcrossHosts(
  hosts: readonly { host: string; rows: readonly ActivityRow[] | null }[],
): ActivityTotal {
  const total: ActivityTotal = {
    turns: 0,
    costUsd: 0,
    tokens: 0,
    unpricedOn: [],
    untokenedOn: [],
    missing: [],
    byHost: [],
  }
  for (const { host, rows } of hosts) {
    if (!rows) {
      total.missing.push(host)
      continue
    }
    const turns = rows.reduce((sum, row) => sum + row.turns, 0)
    const costUsd = rows.reduce((sum, row) => sum + row.costUsd, 0)
    const tokens = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
    if (rows.some((row) => row.unpriced > 0)) total.unpricedOn.push(host)
    // A host that predates token counts reports none for every turn.
    if (rows.some((row) => (row.untokened ?? row.turns) > 0)) total.untokenedOn.push(host)
    total.turns += turns
    total.costUsd += costUsd
    total.tokens += tokens
    total.byHost.push({ host, turns, costUsd, tokens })
  }
  return total
}
