import type { AgentProvider, UsageReading } from './types'
import type { ProviderConfiguration } from './providers/providers'

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
  /** Where the login is signed in: each host and that host's own account id for it. */
  places: { hostId: string; accountId: string }[]
  readings: UsageReading[]
  /** Set when a host without its email was matched to it by identical limits rather than by a sign-in email. */
  matchedBy?: 'limits'
}

/** Two readings of one window agree when they reset at the same moment and, read close together, show the same use. */
const RESET_SLACK_MS = 90_000
const READ_TOGETHER_MS = 15 * 60_000
const windowKey = (reading: UsageReading) => `${reading.window}\0${reading.scope ?? ''}`

/**
 * Whether two logins without an email are one account seen from two hosts: every window both report resets at the same
 * moment, at least one reports a reset, and windows read close together show the same use. Different accounts sharing
 * every reset time and usage is far less likely than the same quota seen twice; a host's own logins never merge.
 */
function sameLimits(a: LoginUsage, b: LoginUsage): boolean {
  if (a.places.some((place) => b.places.some((other) => other.hostId === place.hostId))) return false
  let resets = 0
  for (const reading of a.readings) {
    const other = b.readings.find((entry) => windowKey(entry) === windowKey(reading))
    if (!other) continue
    if (!reading.resetsAt || !other.resetsAt) return false
    if (Math.abs(reading.resetsAt - other.resetsAt) > RESET_SLACK_MS) return false
    if (
      Math.abs(reading.updatedAt - other.updatedAt) < READ_TOGETHER_MS &&
      Math.abs(reading.usedPercent - other.usedPercent) > 2
    )
      return false
    resets++
  }
  return resets > 0
}

function merge(into: LoginUsage, from: LoginUsage) {
  for (const host of from.hosts) if (!into.hosts.includes(host)) into.hosts.push(host)
  into.places.push(...from.places)
  for (const reading of from.readings) {
    const same = into.readings.findIndex((entry) => windowKey(entry) === windowKey(reading))
    if (same < 0) into.readings.push(reading)
    else if (into.readings[same]!.updatedAt < reading.updatedAt) into.readings[same] = reading
  }
  into.matchedBy = 'limits'
}

export function loginsAcrossHosts(hosts: readonly HostUsage[]): LoginUsage[] {
  const logins = new Map<string, LoginUsage>()
  for (const { hostId, host, readings, emails } of hosts)
    for (const reading of readings) {
      const account = reading.accountId ?? 'default'
      const email = emails[reading.provider]?.[account]?.toLowerCase() ?? null
      const key = email ? `${reading.provider}\0${email}` : `${reading.provider}\0${hostId}\0${account}`
      const login = logins.get(key) ?? { provider: reading.provider, email, hosts: [], places: [], readings: [] }
      if (!login.hosts.includes(host)) login.hosts.push(host)
      if (!login.places.some((place) => place.hostId === hostId && place.accountId === account))
        login.places.push({ hostId, accountId: account })
      const window = (entry: UsageReading) => `${entry.window}\0${entry.scope ?? ''}`
      const same = login.readings.findIndex((entry) => window(entry) === window(reading))
      if (same < 0) login.readings.push(reading)
      else if (login.readings[same]!.updatedAt < reading.updatedAt) login.readings[same] = reading
      logins.set(key, login)
    }
  // A host that does not know a login's email can still be signing in to the same account: match it by its limits, to
  // a login known by email first, then to another without one. Emailed logins never merge with each other this way.
  const merged = [...logins.values()].filter((login) => login.email)
  for (const login of logins.values()) {
    if (login.email) continue
    const twin = merged.find((other) => other.provider === login.provider && sameLimits(other, login))
    if (twin) merge(twin, login)
    else merged.push(login)
  }
  return merged
}

/** The window that decides how close a login is to its limit. */
export const peakOf = (login: Pick<LoginUsage, 'readings'>) =>
  [...login.readings].sort((a, b) => b.usedPercent - a.usedPercent)[0]

/** A host's logins with the provider settings that say which login its threads use. */
export type HostLogins = HostUsage & { config: ProviderConfiguration | undefined }

/** One login of a provider as Plan usage lists it, with where it is signed in and whether threads use it. */
export interface LoginRow extends LoginUsage {
  /** Threads use it on the host Plan usage is opened for, or on any host when none is. */
  inUse: boolean
  /** Each host it is signed in on, in host order, and whether that host's threads use it. */
  where: { hostId: string; host: string; inUse: boolean }[]
  /** The host and that host's account id that name it: the current host's own when it is signed in there. */
  namedBy: { hostId: string; accountId: string }
  plan?: string
  /** When its newest reading was taken. */
  newest: number
}

/** Login rows of every provider shown, for the readings of providers that are turned on. */
export function loginRows(hosts: readonly HostLogins[], currentHostId?: string): LoginRow[] {
  const inUseOn = (host: HostLogins | undefined, provider: AgentProvider, accountId: string) =>
    !!host && (host.config?.[provider]?.accountId || 'default') === accountId
  return loginsAcrossHosts(hosts).map((login) => {
    const here = currentHostId ? login.places.find((place) => place.hostId === currentHostId) : undefined
    const where = hosts
      .filter((host) => login.places.some((place) => place.hostId === host.hostId))
      .map((host) => ({
        hostId: host.hostId,
        host: host.host,
        inUse: login.places.some(
          (place) => place.hostId === host.hostId && inUseOn(host, login.provider, place.accountId),
        ),
      }))
    const plan = [...login.readings].filter((r) => r.plan).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.plan
    return {
      ...login,
      inUse: currentHostId
        ? !!here &&
          inUseOn(
            hosts.find((host) => host.hostId === currentHostId),
            login.provider,
            here.accountId,
          )
        : where.some((place) => place.inUse),
      where,
      namedBy: here ?? login.places[0]!,
      ...(plan ? { plan } : {}),
      newest: Math.max(0, ...login.readings.map((reading) => reading.updatedAt)),
    }
  })
}

/**
 * One provider's logins in the order to read them: the one in use first, then ones some host uses, then the ones with
 * the most room.
 */
export function providerLoginRows(rows: readonly LoginRow[], provider: AgentProvider): LoginRow[] {
  return rows
    .filter((row) => row.provider === provider)
    .sort(
      (a, b) =>
        Number(b.inUse) - Number(a.inUse) ||
        Number(b.where.some((place) => place.inUse)) - Number(a.where.some((place) => place.inUse)) ||
        (peakOf(a)?.usedPercent ?? 0) - (peakOf(b)?.usedPercent ?? 0),
    )
}

/** How many logins still have room: none of their windows is at its limit. */
export const loginsWithRoom = (rows: readonly Pick<LoginUsage, 'readings'>[]) =>
  rows.filter((row) => {
    const peak = peakOf(row)
    return !peak || (peak.status !== 'limited' && peak.usedPercent < 100)
  }).length

/** One host's finished turns on one day for one provider; cost and tokens only where the provider reports them. */
export interface ActivityRow {
  day: string
  provider: AgentProvider
  turns: number
  costUsd: number
  /** Turns whose provider reported no cost; they are never counted as free. */
  unpriced: number
  /** Input and output tokens. */
  tokens: number
  /** Turns whose provider reported no tokens; never counted as zero. */
  untokened: number
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
    const tokens = rows.reduce((sum, row) => sum + row.tokens, 0)
    if (rows.some((row) => row.unpriced > 0)) total.unpricedOn.push(host)
    if (rows.some((row) => row.untokened > 0)) total.untokenedOn.push(host)
    total.turns += turns
    total.costUsd += costUsd
    total.tokens += tokens
    total.byHost.push({ host, turns, costUsd, tokens })
  }
  return total
}
