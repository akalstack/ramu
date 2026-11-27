import { DateTime } from 'luxon'
import {
  NO_PROJECT,
  type AgentSettings,
  type Schedule,
  type ScheduleInput,
  type ScheduleRule,
} from '@ramu/shared/types'
import { SOURCE_DEFAULTS, WEBHOOK_PRESETS, type WebhookPreset, type WebhookTrigger } from '@ramu/shared/webhooks'

// The pure parts of the schedule editor and list on the Schedules page: defaults, how a rule changes with its kind, and when saving is allowed.

const LOCAL_INPUT = "yyyy-MM-dd'T'HH:mm"

export const RULE_KINDS: ScheduleRule['kind'][] = ['once', 'daily', 'weekly', 'monthly', 'interval', 'webhook']

/** A webhook rule as a preset sets it up: its sender's signature and repeat key, its filters and what the agent reads. */
export function webhookRule(preset: WebhookPreset): WebhookTrigger {
  const source = SOURCE_DEFAULTS[preset.source]
  return {
    kind: 'webhook',
    source: preset.source,
    filters: preset.filters,
    signature: source.signature,
    replayKey: source.replayKey,
    coalesceKey: preset.coalesceKey,
    coalesceSeconds: 120,
    fields: preset.fields,
  }
}

/** The preset a saved rule still matches, so the editor can show its name; null once filters were changed by hand. */
export function presetOf(rule: WebhookTrigger): WebhookPreset | null {
  return (
    WEBHOOK_PRESETS.find(
      (preset) => preset.source === rule.source && JSON.stringify(preset.filters) === JSON.stringify(rule.filters),
    ) ?? null
  )
}

/** Filter values for `in` are typed as a comma-separated list. */
export const splitList = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

/** A new schedule starts as a daily 09:00 run in the project of the open thread, or in no project. */
export function defaultScheduleInput(
  settings: AgentSettings,
  timezone: string,
  projectId: string | null,
): ScheduleInput {
  return {
    name: '',
    prompt: '',
    projectId: projectId ?? NO_PROJECT,
    workspaceId: null,
    timezone,
    rule: { kind: 'daily', time: '09:00' },
    missedPolicy: 'latest',
    settings,
  }
}

/**
 * A new schedule set on a thread: named after it, in its project and checkout, and sending each run into it, where its
 * own agent and settings answer.
 */
export function threadScheduleInput(
  settings: AgentSettings,
  timezone: string,
  thread: { id: string; title: string; projectId: string; workspaceId: string | null },
): ScheduleInput {
  return {
    ...defaultScheduleInput(settings, timezone, thread.projectId),
    name: thread.title,
    workspaceId: thread.workspaceId,
    sourceTaskId: thread.id,
    targetTaskId: thread.id,
  }
}

/** The value of a `datetime-local` input: the schedule's own one-time moment, or an hour from now, as wall-clock time in `zone`. */
export function onceLocalValue(rule: ScheduleRule | undefined, zone: string, now: DateTime = DateTime.now()): string {
  const at = rule?.kind === 'once' ? DateTime.fromISO(rule.at, { zone }) : now.plus({ hours: 1 }).setZone(zone)
  return at.toFormat(LOCAL_INPUT)
}

/** The instant for a `datetime-local` value read as wall-clock time in `zone`; the input is returned as is when it is not a date. */
export function onceIso(value: string, zone: string): string {
  return DateTime.fromISO(value, { zone }).toISO() ?? value
}

/** The rule a frequency starts with when picked in the editor. */
export function ruleForKind(
  kind: ScheduleRule['kind'],
  onceLocal: string,
  zone: string,
  now: DateTime = DateTime.now(),
): ScheduleRule {
  switch (kind) {
    case 'once':
      return { kind, at: onceIso(onceLocal, zone) }
    case 'weekly':
      return { kind, time: '09:00', weekdays: [1, 2, 3, 4, 5] }
    case 'monthly':
      return { kind, time: '09:00', day: 1 }
    case 'interval':
      return { kind, minutes: 60, anchor: now.plus({ hours: 1 }).toISO()! }
    case 'webhook':
      return webhookRule(WEBHOOK_PRESETS[0]!)
    default:
      return { kind: 'daily', time: '09:00' }
  }
}

/** Ticks or unticks an ISO weekday (1 is Monday) without duplicates, in week order. */
export function setWeekday(weekdays: number[], day: number, on: boolean): number[] {
  const rest = weekdays.filter((entry) => entry !== day)
  return (on ? [...rest, day] : rest).sort((a, b) => a - b)
}

/**
 * Saving waits for a name and a prompt, and for a valid future time (the host's preview is the check) unless a request
 * starts the schedule.
 */
export function canSaveSchedule(form: {
  busy: boolean
  previewLoading: boolean
  preview: number[]
  name: string
  prompt: string
  webhook?: boolean
}): boolean {
  const timed = form.webhook || (!form.previewLoading && form.preview.length > 0)
  return !form.busy && timed && !!form.name.trim() && !!form.prompt.trim()
}

/** Soonest next run first; schedules with nothing upcoming go last. */
export function byNextRun(schedules: Schedule[]): Schedule[] {
  return [...schedules].sort((x, y) => (x.nextRunAt ?? Infinity) - (y.nextRunAt ?? Infinity))
}

export const isProblemRun = (status: string) => status === 'failed' || status === 'interrupted'

type Say = (text: string, values?: Record<string, string | number>) => string

/**
 * When a schedule runs, in a line: "Weekdays at 08:30", "Every 4 hours", "Day 1 of each month at 09:00". A one-time
 * schedule says only "Once", since its card already shows the moment as its next run. `say` translates, and `dayName`
 * names an ISO weekday (1 is Monday) in the reader's language.
 */
export function describeRule(rule: ScheduleRule, say: Say, dayName: (day: number) => string): string {
  switch (rule.kind) {
    case 'once':
      return say('Once')
    case 'webhook':
      return rule.source === 'generic'
        ? say('When a request arrives')
        : say('When {0} sends a request', { 0: SOURCE_DEFAULTS[rule.source].label })
    case 'daily':
      return say('Every day at {time}', { time: rule.time })
    case 'monthly':
      return say('Day {day} of each month at {time}', { day: rule.day, time: rule.time })
    case 'weekly': {
      const days = [...new Set(rule.weekdays)].sort((a, b) => a - b)
      if (days.length === 7) return say('Every day at {time}', { time: rule.time })
      if (days.join() === '1,2,3,4,5') return say('Weekdays at {time}', { time: rule.time })
      if (days.join() === '6,7') return say('Weekends at {time}', { time: rule.time })
      return say('{days} at {time}', { days: days.map(dayName).join(', '), time: rule.time })
    }
    case 'interval': {
      const every = (unit: number, one: string, many: string) =>
        rule.minutes === unit ? say(one) : say(many, { count: rule.minutes / unit })
      if (rule.minutes % 10080 === 0) return every(10080, 'Every week', 'Every {count} weeks')
      if (rule.minutes % 1440 === 0) return every(1440, 'Every day', 'Every {count} days')
      if (rule.minutes % 60 === 0) return every(60, 'Every hour', 'Every {count} hours')
      return say('Every {count} minutes', { count: rule.minutes })
    }
  }
}
