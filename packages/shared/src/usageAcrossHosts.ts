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
