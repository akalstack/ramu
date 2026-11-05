import type { AgentProvider, UsageReading } from '../types'
import { ANTIGRAVITY_SCOPES, usageAppliesTo } from '@ramu/shared/providers/usageScope'

export const USAGE_STALE_MS = 10 * 60_000
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
  if (reading.provider === 'cursor' && reading.window === 'monthly' && !reading.scope)
    return language === 'id' ? 'Keseluruhan' : 'Overall'
  const labels = {
    five_hour: language === 'id' ? '5 jam' : short ? '5h' : '5-hour',
    weekly: language === 'id' ? (short ? 'mgg' : 'Mingguan') : short ? 'wk' : 'Weekly',
    monthly: language === 'id' ? (short ? 'bln' : 'Bulanan') : short ? 'mo' : 'Monthly',
    quota: language === 'id' ? 'Kuota' : 'Quota',
  }
  return reading.scope ? `${reading.scope} · ${labels[reading.window]}` : labels[reading.window]
}

/** Explain provider-reported pools without inventing scopes for other readings. */
export function usageScopeHint(reading: UsageReading, language: 'en' | 'id' = 'en'): string | undefined {
  if (reading.provider === 'cursor') {
    if (reading.window === 'monthly' && !reading.scope)
      return language === 'id'
        ? 'Pemakaian gabungan dari kedua jatah, bukan kuota ketiga.'
        : 'Combined usage across both allowances, not a third quota.'
    if (reading.scope === 'Cursor models')
      return language === 'id'
        ? 'Grok dan Composer memakai ini lebih dulu. Auto bisa memakai salah satu jatah.'
        : 'Grok and Composer use this first. Auto can use either pool.'
    if (reading.scope === 'Other models')
      return language === 'id'
        ? 'Claude, GPT, dan Gemini memakai jatah ini. Grok dan Composer beralih ke sini bila habis.'
        : 'Claude, GPT, and Gemini use this pool. Grok and Composer fall back here.'
  }
  if (reading.provider === 'antigravity') {
    if (reading.scope === ANTIGRAVITY_SCOPES.partner || reading.scope === 'Claude' || reading.scope === 'GPT')
      return language === 'id' ? 'Claude dan GPT berbagi satu jatah.' : 'Claude and GPT share one allowance.'
    if (reading.scope === ANTIGRAVITY_SCOPES.argon)
      return language === 'id'
        ? 'Jatah mingguan sendiri, terpisah dari model Gemini lain.'
        : 'Its own weekly allowance, separate from the other Gemini models.'
  }
  return undefined
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
