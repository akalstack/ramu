import type { AgentProvider, UsageReading } from '@ramu/shared/types'
import { providerAccountId } from './providerBinaries'

/** The latest plan usage per provider and window, kept across restarts. Readings only arrive while a provider runs. */
export class UsageService {
  private readings: UsageReading[]
  constructor(load: () => UsageReading[], private readonly persist: (readings: UsageReading[]) => void, private readonly broadcast: (readings: UsageReading[]) => void) {
    this.readings = load()
    // Lets screenshots and UI work show gauges without a live account: RAMU_FAKE_USAGE='[{"provider":"codex","window":"five_hour","usedPercent":40}]'.
    if (process.env.RAMU_FAKE_USAGE) try { this.update((JSON.parse(process.env.RAMU_FAKE_USAGE) as Partial<UsageReading>[]).map((r) => ({ status: 'ok', updatedAt: Date.now(), ...r }) as UsageReading)) } catch {}
  }

  list(accounts: Partial<Record<AgentProvider, string>> = {}): UsageReading[] { return this.readings.filter((reading) => (reading.accountId ?? 'default') === (accounts[reading.provider] ?? providerAccountId(reading.provider))) }

  /** Every account's readings, for choosing which login a chat continues on. */
  all(): UsageReading[] { return this.readings }

  update(next: UsageReading[]): void {
    if (!next.length) return
    const key = (r: UsageReading) => `${r.provider}:${r.accountId ?? 'default'}:${r.window}:${r.scope ?? ''}`
    const merged = new Map(this.readings.map((r) => [key(r), r]))
    for (const reading of next) merged.set(key(reading), reading)
    this.readings = [...merged.values()]
    this.persist(this.readings)
    this.broadcast(this.list())
  }
}

/**
 * Claude's `rate_limit_event` info. In practice every window arrives in `unifiedWindows`
 * (`five_hour`, `seven_day`, and model-specific ones); the single `utilization` form is what the typings describe.
 */
export interface ClaudeRateLimitInfo {
  status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number; surpassedThreshold?: number
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number } | null>
}

const WINDOWS: Record<string, { window: UsageReading['window']; scope?: string }> = {
  five_hour: { window: 'five_hour' }, seven_day: { window: 'weekly' }, seven_day_opus: { window: 'weekly', scope: 'Opus' }, seven_day_sonnet: { window: 'weekly', scope: 'Sonnet' },
}
const seconds = (value: number | undefined) => typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : undefined

/** The readings one event carries: each known window with its percentage and reset time. */
export function claudeReadings(info: ClaudeRateLimitInfo, previous: UsageReading[] = [], now = Date.now()): UsageReading[] {
  const entries: [string, { utilization?: number; resetsAt?: number }][] = Object.entries(info.unifiedWindows ?? {}).flatMap(([type, value]) => value ? [[type, value] as [string, { utilization?: number; resetsAt?: number }]] : [])
  // The documented form: one window, named by rateLimitType.
  if (info.rateLimitType && !entries.some(([type]) => type === info.rateLimitType)) entries.push([info.rateLimitType, { utilization: info.utilization, resetsAt: info.resetsAt }])
  return entries.flatMap(([type, value]): UsageReading[] => {
    const known = WINDOWS[type]
    if (!known) return []
    const prior = previous.find((r) => r.provider === 'claude-code' && r.window === known.window && r.scope === known.scope)
    const rejected = info.status === 'rejected' && info.rateLimitType === type
    const percent = typeof value.utilization === 'number' ? value.utilization * 100 : rejected ? 100 : type === info.rateLimitType && typeof info.surpassedThreshold === 'number' ? info.surpassedThreshold * 100 : prior?.usedPercent
    if (percent === undefined) return []
    const resetsAt = seconds(value.resetsAt) ?? prior?.resetsAt
    const usedPercent = Math.max(0, Math.min(100, Math.round(percent)))
    return [{ provider: 'claude-code' as AgentProvider, window: known.window, ...(known.scope ? { scope: known.scope } : {}), usedPercent, ...(resetsAt ? { resetsAt } : {}), status: rejected || usedPercent >= 100 ? 'limited' : info.status === 'allowed_warning' && type === info.rateLimitType ? 'warning' : usedPercent >= 80 ? 'warning' : 'ok', updatedAt: now }]
  })
}

/** The on-demand read (`usage_EXPERIMENTAL…`): utilization is 0–100 and resets_at an ISO timestamp. */
export interface ClaudeUsageResponse {
  subscription_type?: string | null
  rate_limits?: Record<string, { utilization?: number | null; resets_at?: string | null } | null> | null
}

export function claudeUsageReadings(response: ClaudeUsageResponse, now = Date.now()): UsageReading[] {
  return Object.entries(response.rate_limits ?? {}).flatMap(([type, value]): UsageReading[] => {
    const known = WINDOWS[type]
    if (!known || !value || typeof value.utilization !== 'number') return []
    const usedPercent = Math.max(0, Math.min(100, Math.round(value.utilization)))
    const resetsAt = value.resets_at ? Date.parse(value.resets_at) : NaN
    return [{ provider: 'claude-code', window: known.window, ...(known.scope ? { scope: known.scope } : {}), usedPercent, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}), status: usedPercent >= 100 ? 'limited' : usedPercent >= 80 ? 'warning' : 'ok', ...(response.subscription_type ? { plan: response.subscription_type } : {}), updatedAt: now }]
  })
}
