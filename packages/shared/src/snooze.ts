// How long a recap item can be snoozed. The host enforces the bounds, the apps pick the time.

export const DEFAULT_SNOOZE_MS = 86_400_000
export const MAX_SNOOZE_MS = 30 * 86_400_000

export type SnoozeChoice = 'in-3-hours' | 'tomorrow' | 'next-week'
export const SNOOZE_CHOICES: SnoozeChoice[] = ['in-3-hours', 'tomorrow', 'next-week']

/** Hour of day (local time) that "Tomorrow" and "Next week" return at. */
const MORNING = 9

/** When a snooze ends, in local time: three hours on, tomorrow at 09:00, or next Monday at 09:00. Always after `now`. */
export function snoozeUntil(choice: SnoozeChoice, now: number = Date.now()): number {
  const from = new Date(now)
  if (choice === 'in-3-hours') return now + 3 * 3_600_000
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate(), MORNING)
  if (choice === 'tomorrow') {
    day.setDate(day.getDate() + 1)
    return day.getTime()
  }
  // Next Monday, never today: from a Monday, that is a week away.
  day.setDate(day.getDate() + ((8 - day.getDay()) % 7 || 7))
  return day.getTime()
}
