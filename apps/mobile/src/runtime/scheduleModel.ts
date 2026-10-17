import type { AgentSettings, Schedule, ScheduleInput, ScheduleRule, ScheduleRun } from '@ramu/shared/types'

// Describing, validating and building schedules for the phone. No React Native in here, so it is unit tested.

export type Lang = 'en' | 'id'

export const NO_PROJECT = 'no-project'
export const MIN_INTERVAL_MINUTES = 5

/** ISO weekdays, as the host numbers them: 1 is Monday and 7 is Sunday. */
export const WEEKDAYS: { day: number; short: Record<Lang, string>; long: Record<Lang, string> }[] = [
  { day: 1, short: { en: 'M', id: 'S' }, long: { en: 'Mon', id: 'Sen' } },
  { day: 2, short: { en: 'T', id: 'S' }, long: { en: 'Tue', id: 'Sel' } },
  { day: 3, short: { en: 'W', id: 'R' }, long: { en: 'Wed', id: 'Rab' } },
  { day: 4, short: { en: 'T', id: 'K' }, long: { en: 'Thu', id: 'Kam' } },
  { day: 5, short: { en: 'F', id: 'J' }, long: { en: 'Fri', id: 'Jum' } },
  { day: 6, short: { en: 'S', id: 'S' }, long: { en: 'Sat', id: 'Sab' } },
  { day: 7, short: { en: 'S', id: 'M' }, long: { en: 'Sun', id: 'Min' } },
]

export const RULE_KINDS: ScheduleRule['kind'][] = ['daily', 'weekly', 'monthly', 'interval', 'once']
export const RULE_LABELS: Record<ScheduleRule['kind'], Record<Lang, string>> = {
  daily: { en: 'Daily', id: 'Harian' },
  weekly: { en: 'Weekly', id: 'Mingguan' },
  monthly: { en: 'Monthly', id: 'Bulanan' },
  interval: { en: 'Every…', id: 'Setiap…' },
  once: { en: 'Once', id: 'Sekali' },
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "09:05" from a time that may be loosely typed; null when it is not a time of day. */
export function parseTime(value: string): string | null {
  const match = /^\s*(\d{1,2})(?::?(\d{2}))?\s*$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  if (hour > 23 || minute > 59) return null
  return `${pad(hour)}:${pad(minute)}`
}

/** Moves a "HH:mm" time by `minutes`, wrapping around midnight. */
export function shiftTime(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export function intervalText(minutes: number, lang: Lang = 'en'): string {
  const id = lang === 'id'
  if (minutes % 10080 === 0) {
    const n = minutes / 10080
    return id ? `${n} minggu` : n === 1 ? 'week' : `${n} weeks`
  }
  if (minutes % 1440 === 0) {
    const n = minutes / 1440
    return id ? `${n} hari` : n === 1 ? 'day' : `${n} days`
  }
  if (minutes % 60 === 0) {
    const n = minutes / 60
    return id ? `${n} jam` : n === 1 ? 'hour' : `${n} hours`
  }
  return id ? `${minutes} menit` : `${minutes} minutes`
}

/** One line for a schedule's rule: "Weekdays at 09:00", "Every 2 hours", "Once, Oct 18 at 14:30". */
export function describeRule(rule: ScheduleRule, lang: Lang = 'en', timezone?: string): string {
  const id = lang === 'id'
  switch (rule.kind) {
    case 'daily':
      return id ? `Setiap hari pukul ${rule.time}` : `Every day at ${rule.time}`
    case 'weekly': {
      const days = [...new Set(rule.weekdays)].sort((a, b) => a - b)
      const label =
        days.length === 7
          ? id
            ? 'Setiap hari'
            : 'Every day'
          : days.join() === '1,2,3,4,5'
            ? id
              ? 'Hari kerja'
              : 'Weekdays'
            : days.join() === '6,7'
              ? id
                ? 'Akhir pekan'
                : 'Weekends'
              : days.map((d) => WEEKDAYS.find((w) => w.day === d)?.long[lang] ?? d).join(', ')
      return id ? `${label} pukul ${rule.time}` : `${label} at ${rule.time}`
    }
    case 'monthly':
      return id ? `Tanggal ${rule.day} tiap bulan pukul ${rule.time}` : `Day ${rule.day} of each month at ${rule.time}`
    case 'interval':
      return id ? `Setiap ${intervalText(rule.minutes, lang)}` : `Every ${intervalText(rule.minutes, lang)}`
    case 'once':
      return `${id ? 'Sekali' : 'Once'}, ${formatWhen(Date.parse(rule.at), timezone, lang)}`
  }
}

/** "Sat, Oct 18 · 09:00", in the schedule's own timezone so it reads the same on the phone and the computer. */
export function formatWhen(at: number, timezone?: string, lang: Lang = 'en'): string {
  if (!Number.isFinite(at)) return '—'
  try {
    const locale = lang === 'id' ? 'id-ID' : 'en-US'
    const date = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    }).format(at)
    const time = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).format(at)
    return `${date} · ${time}`
  } catch {
    return new Date(at).toLocaleString()
  }
}

export function nextRunText(schedule: Schedule, lang: Lang = 'en'): string {
  if (schedule.state === 'paused') return lang === 'id' ? 'Dijeda' : 'Paused'
  if (schedule.nextRunAt === null) return lang === 'id' ? 'Tidak ada jadwal berikutnya' : 'No upcoming run'
  return formatWhen(schedule.nextRunAt, schedule.timezone, lang)
}

/** The wall-clock moment `date` + `time` in this device's timezone as an ISO instant with an explicit offset. */
export function onceInstant(date: Date, time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0)
  return at.toISOString()
}

export const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function defaultInput(settings: AgentSettings, projectId = NO_PROJECT): ScheduleInput {
  return {
    name: '',
    prompt: '',
    projectId,
    workspaceId: null,
    timezone: deviceTimezone(),
    rule: { kind: 'daily', time: '09:00' },
    missedPolicy: 'latest',
    settings,
  }
}

/** Switches the rule's kind and keeps what carries over (the time of day), so flipping the picker is not destructive. */
export function ruleOfKind(kind: ScheduleRule['kind'], previous: ScheduleRule, now = new Date()): ScheduleRule {
  if (previous.kind === kind) return previous
  const time = 'time' in previous ? previous.time : '09:00'
  switch (kind) {
    case 'daily':
      return { kind, time }
    case 'weekly':
      return { kind, time, weekdays: [1, 2, 3, 4, 5] }
    case 'monthly':
      return { kind, time, day: Math.min(now.getDate(), 28) }
    case 'interval':
      return { kind, minutes: 60, anchor: now.toISOString() }
    case 'once':
      return { kind, at: onceInstant(addDays(now, 1), time) }
  }
}

export function toggleWeekday(weekdays: number[], day: number): number[] {
  const has = weekdays.includes(day)
  if (has && weekdays.length === 1) return weekdays // a weekly schedule needs a day
  return (has ? weekdays.filter((d) => d !== day) : [...weekdays, day]).sort((a, b) => a - b)
}

/** What is wrong with the form, in words, or null when it can be saved. The host validates again. */
export function validateInput(input: ScheduleInput, now = Date.now(), lang: Lang = 'en'): string | null {
  const id = lang === 'id'
  if (!input.name.trim()) return id ? 'Beri nama jadwal ini.' : 'Give the schedule a name.'
  if (!input.prompt.trim()) return id ? 'Tulis apa yang harus dikerjakan agen.' : 'Say what the agent should do.'
  const { rule } = input
  if (rule.kind !== 'once' && rule.kind !== 'interval' && !parseTime(rule.time))
    return id ? 'Waktu tidak valid.' : 'That is not a valid time.'
  if (rule.kind === 'weekly' && !rule.weekdays.length)
    return id ? 'Pilih minimal satu hari.' : 'Pick at least one weekday.'
  if (rule.kind === 'monthly' && (rule.day < 1 || rule.day > 31))
    return id ? 'Tanggal harus antara 1 dan 31.' : 'The day must be between 1 and 31.'
  if (rule.kind === 'interval' && rule.minutes < MIN_INTERVAL_MINUTES)
    return id
      ? `Interval minimal ${MIN_INTERVAL_MINUTES} menit.`
      : `Repeat at least every ${MIN_INTERVAL_MINUTES} minutes.`
  if (rule.kind === 'once' && !(Date.parse(rule.at) > now))
    return id ? 'Pilih waktu di masa depan.' : 'Choose a time in the future.'
  return null
}

/** Active schedules first (soonest next run on top), then paused, then completed. */
export function sortSchedules(schedules: Schedule[]): Schedule[] {
  const rank = { active: 0, paused: 1, completed: 2 } as const
  return [...schedules].sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) ||
      a.name.localeCompare(b.name),
  )
}

export type RunTone = 'ok' | 'warn' | 'bad' | 'accent' | 'muted'
export function runTone(status: ScheduleRun['status']): RunTone {
  switch (status) {
    case 'completed':
      return 'ok'
    case 'failed':
      return 'bad'
    case 'needs-input':
    case 'missed':
      return 'warn'
    case 'running':
    case 'queued':
      return 'accent'
    default:
      return 'muted'
  }
}

export const RUN_LABELS: Record<ScheduleRun['status'], Record<Lang, string>> = {
  queued: { en: 'Queued', id: 'Antre' },
  running: { en: 'Running', id: 'Berjalan' },
  'needs-input': { en: 'Needs you', id: 'Butuh kamu' },
  completed: { en: 'Completed', id: 'Selesai' },
  failed: { en: 'Failed', id: 'Gagal' },
  missed: { en: 'Missed', id: 'Terlewat' },
  interrupted: { en: 'Interrupted', id: 'Terhenti' },
}

/** Runs of one schedule, newest due first. */
export const runsOf = (runs: ScheduleRun[], scheduleId: string) =>
  runs.filter((run) => run.scheduleId === scheduleId).sort((a, b) => b.dueAt - a.dueAt)
