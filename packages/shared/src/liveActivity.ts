import type { LiveActivityThreadStatus, LiveActivityTone, MobileLiveActivityContent } from './api'

/** How long an activity's content holds before iOS shows it as out of date, unless something updates it first. */
export const LIVE_ACTIVITY_STALE_MS = 10 * 60_000
/** How long the finished activity stays on the Lock Screen: long enough to notice, not for the rest of the day. */
export const LIVE_ACTIVITY_DONE_MS = 4 * 60_000

const ATTENTION: readonly LiveActivityThreadStatus[] = ['approval', 'question', 'input', 'limit']
/** Most urgent first: what the person must answer, then what broke, then what still runs, then what is over. */
const URGENCY: readonly LiveActivityThreadStatus[] = [...ATTENTION, 'failed', 'working', 'done']

const liveActivityNeedsPerson = (status: LiveActivityThreadStatus) => ATTENTION.includes(status)
/** Whether a thread in this state keeps the stretch of work, and so the activity, going. */
export const liveActivityOngoing = (status: LiveActivityThreadStatus) =>
  status === 'working' || liveActivityNeedsPerson(status)

function tone(counts: { running: number; waiting: number; failed: number }): LiveActivityTone {
  return counts.waiting ? 'attention' : counts.failed ? 'failed' : counts.running ? 'working' : 'done'
}

function phase(counts: { running: number; waiting: number }): MobileLiveActivityContent['phase'] {
  return counts.waiting ? 'waiting' : counts.running ? 'working' : 'finished'
}

/** Threads most urgent first; among threads in the same state the given order is kept. */
export function liveActivityOrder<T extends { status: LiveActivityThreadStatus }>(threads: readonly T[]): T[] {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => URGENCY.indexOf(a.thread.status) - URGENCY.indexOf(b.thread.status) || a.index - b.index)
    .map(({ thread }) => thread)
}

/** Longest title a row shows; the Lock Screen truncates further, this keeps the payload small. */
const TITLE_LENGTH = 48

/**
 * The activity's content from the threads of the current stretch, most urgent first, as the phone builds it. Order
 * among threads of the same state is kept, so the caller decides which comes first.
 */
export function liveActivityContent(
  threads: readonly { title: string; status: LiveActivityThreadStatus }[],
  base: { startedAt: number; updatedAt: number; locale: 'en' | 'id' },
): MobileLiveActivityContent {
  const count = (match: (status: LiveActivityThreadStatus) => boolean) =>
    threads.filter((thread) => match(thread.status)).length
  const counts = {
    running: count((s) => s === 'working'),
    waiting: count(liveActivityNeedsPerson),
    failed: count((s) => s === 'failed'),
    done: count((s) => s === 'done'),
  }
  const sorted = liveActivityOrder(threads)
  const need = sorted.find((thread) => liveActivityNeedsPerson(thread.status))?.status as
    MobileLiveActivityContent['need'] | undefined
  return {
    running: counts.running,
    waiting: counts.waiting,
    ...base,
    phase: phase(counts),
    tone: tone(counts),
    ...(need ? { need } : {}),
    ...(counts.failed ? { failed: counts.failed } : {}),
    ...(counts.done ? { done: counts.done } : {}),
    rows: sorted.slice(0, 3).map((thread) => {
      const title = thread.title.replace(/\s+/g, ' ').trim()
      return {
        title: title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : title,
        status: thread.status,
      }
    }),
  }
}

/** The content a host pushes: counts only, since a push travels through Apple and possibly Ramu Link. */
export function liveActivityCountsContent(
  counts: { running: number; needsInput: number },
  base: { startedAt: number; updatedAt: number; locale: 'en' | 'id' },
  ended: boolean,
): MobileLiveActivityContent {
  const shown = ended
    ? { running: 0, waiting: 0, failed: 0 }
    : { running: counts.running, waiting: counts.needsInput, failed: 0 }
  return {
    running: shown.running,
    waiting: shown.waiting,
    ...base,
    phase: phase(shown),
    tone: tone(shown),
    ...(shown.waiting ? { need: 'input' as const } : {}),
  }
}
