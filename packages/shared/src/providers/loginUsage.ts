import { translate, type Language } from '../i18n'
import type { AgentProvider, UsageReading } from '../types'
import { isOver, peakFor } from './routing'

/** How much room one login has for a model, from its own readings: the window closest to its limit. */
export type LoginUsage = { limited: boolean; reading: UsageReading }

/** Readings without an account belong to the provider's first login. */
export function loginUsage(
  readings: readonly UsageReading[],
  provider: AgentProvider,
  accountId: string,
  model: string,
  now = Date.now(),
): LoginUsage | null {
  const own = readings.filter((reading) => (reading.accountId ?? 'default') === accountId)
  const reading = peakFor(own, provider, model, now)
  return reading ? { limited: isOver(reading, null), reading } : null
}

const WINDOW = {
  five_hour: '{0}% of the 5-hour limit used',
  weekly: '{0}% of the weekly limit used',
  monthly: '{0}% of the monthly limit used',
  quota: '{0}% of the quota used',
} as const

/**
 * One line under a login in an account list, so a person sees before choosing it whether it can run now: "Limit reached
 * · resets Thu 12:59" or "58% of the weekly limit used".
 */
export function loginUsageLine(usage: LoginUsage | null, language: Language, now = Date.now()): string | undefined {
  if (!usage) return undefined
  const { reading } = usage
  if (!usage.limited) return translate(language, WINDOW[reading.window], { 0: Math.round(reading.usedPercent) })
  if (!reading.resetsAt || reading.resetsAt <= now) return translate(language, 'Limit reached')
  const at = new Date(reading.resetsAt)
  const locale = language === 'id' ? 'id-ID' : 'en-US'
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const when =
    reading.resetsAt - now < 20 * 60 * 60_000 ? time : `${at.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
  return translate(language, 'Limit reached · resets {0}', { 0: when })
}
