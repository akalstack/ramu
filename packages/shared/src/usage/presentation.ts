import type { AgentProvider, UsageReading } from '../types'
import { usageAppliesTo } from '@ramu/shared/providers/usageScope'

export const USAGE_STALE_MS = 10 * 60_000
/**
 * Providers that report plan usage only to their own apps. Ramu never reads their quota services with a borrowed login,
 * so it learns a limit from what the runtime says when one is reached.
 */
export const usageOnlyAtLimit = (provider: AgentProvider): boolean =>
  provider === 'opencode' || provider === 'cursor' || provider === 'antigravity'
export const usagePercent = (reading: UsageReading): number | null =>
  reading.source === 'notice' || !Number.isFinite(reading.usedPercent)
    ? null
    : Math.max(0, Math.min(100, reading.usedPercent))
export const usageTone = (reading: Pick<UsageReading, 'usedPercent' | 'status'>): 'ok' | 'warn' | 'bad' =>
  reading.status === 'limited' || reading.usedPercent >= 90 ? 'bad' : reading.usedPercent >= 70 ? 'warn' : 'ok'
export const usageStale = (reading: UsageReading, now: number): boolean =>
  !Number.isFinite(reading.updatedAt) ||
  now - reading.updatedAt > USAGE_STALE_MS ||
  Boolean(reading.resetsAt && reading.resetsAt <= now)
export function usageWindow(reading: UsageReading, short = false, language: 'en' | 'id' = 'en'): string {
  const labels = {
    five_hour: language === 'id' ? '5 jam' : short ? '5h' : '5-hour',
    weekly: language === 'id' ? (short ? 'mgg' : 'Mingguan') : short ? 'wk' : 'Weekly',
    monthly: language === 'id' ? (short ? 'bln' : 'Bulanan') : short ? 'mo' : 'Monthly',
    quota: language === 'id' ? 'Kuota' : 'Quota',
  }
  return reading.scope ? `${reading.scope} · ${labels[reading.window]}` : labels[reading.window]
}

/** Unknown account identity is safe only when the host reported one unambiguous account. */
export function relevantUsage(
  readings: UsageReading[],
  target: { provider: AgentProvider; accountId?: string; model?: string },
): UsageReading | undefined {
  let own = readings.filter((r) => r.provider === target.provider)
  if (target.accountId !== undefined) own = own.filter((r) => (r.accountId ?? 'default') === target.accountId)
  else if (new Set(own.map((r) => r.accountId ?? 'default')).size > 1) return undefined
  // Unknown provider scope rules must not be guessed from arbitrary model substrings.
  own = own.filter((r) => usageAppliesTo(r, target.model))
  return [...own].sort(
    (a, b) =>
      (b.status === 'limited' ? 1 : 0) - (a.status === 'limited' ? 1 : 0) ||
      (usagePercent(b) ?? -1) - (usagePercent(a) ?? -1) ||
      b.updatedAt - a.updatedAt,
  )[0]
}
export interface HostUsage {
  id: string
  online: boolean
  readings: UsageReading[]
}
export function summaryUsage(
  hosts: HostUsage[],
  now: number,
): { hostId: string; reading: UsageReading; lastKnown: boolean } | undefined {
  return hosts
    .flatMap((host) =>
      host.readings.map((reading) => ({
        hostId: host.id,
        reading,
        lastKnown: !host.online || usageStale(reading, now),
      })),
    )
    .sort(
      (a, b) =>
        Number(a.lastKnown) - Number(b.lastKnown) ||
        Number(b.reading.status === 'limited') - Number(a.reading.status === 'limited') ||
        (usagePercent(b.reading) ?? -1) - (usagePercent(a.reading) ?? -1) ||
        a.hostId.localeCompare(b.hostId) ||
        a.reading.provider.localeCompare(b.reading.provider),
    )[0]
}

export interface ProviderUsageGroup {
  provider: UsageReading['provider']
  readings: UsageReading[]
  /** Readings that are limited or at/over `warnAt` percent, so a collapsed group can still show trouble. */
  attention: number
}

/** Groups readings by provider in first-seen order, counting those that need attention. Missing data never counts as fine. */
export function groupUsageByProvider(readings: UsageReading[], warnAt = 80): ProviderUsageGroup[] {
  const groups = new Map<string, ProviderUsageGroup>()
  for (const reading of readings) {
    const group = groups.get(reading.provider) ?? { provider: reading.provider, readings: [], attention: 0 }
    group.readings.push(reading)
    const percent = usagePercent(reading)
    if (reading.status === 'limited' || (percent !== null && percent >= warnAt)) group.attention++
    groups.set(reading.provider, group)
  }
  return [...groups.values()]
}
