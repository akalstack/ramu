import type { ChatGoal, LibrarySummary, RecapItem, TaskStatus, ThreadInputSummary } from './types'
import { goalContinues } from '@ramu/shared/chat/goalHold'

// Shared desktop/mobile inbox: what needs you, what is running, recaps, learning, and finished work.
// Keep derivation independent of rendering and apply host scope before limits or counts.

export type InboxTab = 'all' | 'needs-you' | 'running' | 'recaps' | 'learned' | 'completed'
export const INBOX_TABS: InboxTab[] = ['all', 'needs-you', 'running', 'recaps', 'learned', 'completed']

/** The few fields of a chat the Inbox cares about; the app's `Chat` satisfies it. */
export interface InboxChat {
  id: string
  taskId: string
  computerId: string
  status: TaskStatus
  inputSummary?: ThreadInputSummary | null
  /** Mobile has the live goal; desktop supplies the compact task summary. */
  goal?: Pick<ChatGoal, 'status' | 'pausedBy'> | null
  goalState?: (Pick<ChatGoal, 'status' | 'pausedBy'> & { reason?: string; verificationFailed?: boolean }) | null
  /** Independently running helpers; the phone has them in its helper groups, the desktop in `tasks.list`. */
  helperSummary?: { active: number } | null
  lastActiveAt: number
  sessionId: string | null
  doneAt?: number | null
  pending?: boolean
}

/** Why a thread is waiting on the person, in the order a person would act on it. */
export type InboxBlockerKind =
  'approval' | 'connector' | 'question' | 'verification-failed' | 'goal-blocked' | 'turn-limit' | 'goal-paused'

export interface InboxBlocker {
  kind: InboxBlockerKind
  /** How many requests when it is an input request. */
  count?: number
  /** The host's own explanation, for a blocked goal. */
  reason?: string
}

/**
 * What a waiting thread needs from the person: the first of an open request (approval before connector sign-in before a
 * question), a failed completion check, a blocked goal, the turn limit or a pause. Null when nothing is asked of them.
 * Derived from the same fields `buildInbox` uses to decide a thread is waiting, so a row never says "waiting" without a reason.
 */
export function inboxBlocker(chat: InboxChat): InboxBlocker | null {
  const input = chat.inputSummary
  if (input?.count) {
    if (input.approvals > 0) return { kind: 'approval', count: input.approvals }
    if (input.connectors) return { kind: 'connector', count: input.connectors }
    return { kind: 'question', count: input.count }
  }
  const goal = chat.goal === undefined ? chat.goalState : chat.goal
  const detail = chat.goalState?.reason ? { reason: chat.goalState.reason } : {}
  if (chat.goalState?.verificationFailed && goal && goal.status !== 'completed')
    return { kind: 'verification-failed', ...detail }
  if (goal?.status === 'blocked') return { kind: 'goal-blocked', ...detail }
  if (goal?.status === 'turn-limit') return { kind: 'turn-limit' }
  if (goal?.status === 'paused' && !goalContinues(goal)) return { kind: 'goal-paused' }
  return chat.status === 'needs-input' ? { kind: 'question', count: 1 } : null
}

export interface InboxRecap {
  computerId: string
  item: RecapItem
}
export interface InboxSummary {
  computerId: string
  summary: LibrarySummary
}

/** Threads finished within this many days (counting today) are listed under Completed. */
export const COMPLETED_DAYS = 7
export const COMPLETED_MAX = 50
export const LEARNED_MAX = 20

const DAY = 86_400_000

export const startOfDay = (at: number) => {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** A recap item is live when open, or snoozed and the snooze has run out. */
export function isLiveRecap(item: RecapItem, now: number) {
  return item.status === 'open' || (item.status === 'snoozed' && (item.snoozedUntil ?? 0) <= now)
}

/**
 * Live recap items for threads that still exist, newest first, split into those that need a decision and recent ones.
 * Recent ones are "since your last visit" when updated after `visit`, otherwise earlier.
 */
export function splitRecaps(
  recaps: InboxRecap[],
  chats: Pick<InboxChat, 'taskId' | 'computerId'>[],
  visit: number,
  now: number,
) {
  const live = recaps
    .filter(
      ({ computerId, item }) =>
        isLiveRecap(item, now) && chats.some((chat) => chat.computerId === computerId && chat.taskId === item.taskId),
    )
    .sort((a, b) => b.item.updatedAt - a.item.updatedAt)
  const attention = live.filter((r) => r.item.group === 'attention')
  const recent = live.filter((r) => r.item.group === 'recent')
  const sinceVisit = recent.filter((r) => r.item.updatedAt > visit)
  return { attention, recent, sinceVisit, earlier: recent.filter((r) => !sinceVisit.includes(r)) }
}

export interface CompletedDay {
  label: 'today' | 'yesterday' | 'earlier'
  items: InboxChat[]
}

export function buildInbox(input: {
  chats: InboxChat[]
  /** Null or omitted means all hosts. Filter before limits and counts are calculated. */
  computerId?: string | null
  recaps: InboxRecap[]
  summaries: InboxSummary[]
  /** Recaps are only shown when the computer has them turned on. */
  recapsEnabled?: (computerId: string) => boolean
  visit?: number
  now?: number
}) {
  const now = input.now ?? Date.now()
  const inScope = (id: string) => !input.computerId || id === input.computerId
  const live = input.chats.filter(
    (chat) => inScope(chat.computerId) && !chat.pending && !chat.doneAt && chat.status !== 'archived',
  )
  const goalOf = (chat: InboxChat) => (chat.goal === undefined ? chat.goalState : chat.goal)
  const unfinished = (chat: InboxChat) => {
    const goal = goalOf(chat)
    return !!goal && goal.status !== 'completed'
  }
  const needsInput = (chat: InboxChat) => {
    const goal = goalOf(chat)
    return (
      chat.status === 'needs-input' ||
      !!chat.inputSummary?.count ||
      goal?.status === 'blocked' ||
      goal?.status === 'turn-limit' ||
      (goal?.status === 'paused' && !goalContinues(goal))
    )
  }
  const waiting = live.filter(needsInput).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  // Independent helpers keep a thread running after its own turn ends, as the finished-thread gate does for notices.
  const helpersRunning = (chat: InboxChat) => (chat.helperSummary?.active ?? 0) > 0
  const running = live
    .filter(
      (chat) => (chat.status === 'running' || goalContinues(goalOf(chat)) || helpersRunning(chat)) && !needsInput(chat),
    )
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const enabled = input.recapsEnabled ?? (() => true)
  const recaps = splitRecaps(
    input.recaps.filter((r) => inScope(r.computerId) && enabled(r.computerId)),
    live,
    input.visit ?? 0,
    now,
  )
  const summaries = input.summaries
    .filter((s) => inScope(s.computerId) && s.summary.status !== 'dismissed')
    .sort((a, b) => b.summary.periodEnd - a.summary.periodEnd)
    .slice(0, LEARNED_MAX)
  const today = startOfDay(now)
  const since = today - (COMPLETED_DAYS - 1) * DAY
  const completed = live
    .filter(
      (chat) =>
        (chat.status === 'ready-for-review' || chat.status === 'idle' || chat.status === 'failed') &&
        !needsInput(chat) &&
        !unfinished(chat) &&
        !helpersRunning(chat) &&
        chat.sessionId,
    )
    .filter((chat) => chat.lastActiveAt >= since)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, COMPLETED_MAX)
  const days: CompletedDay[] = (
    [
      { label: 'today', items: completed.filter((chat) => chat.lastActiveAt >= today) },
      {
        label: 'yesterday',
        items: completed.filter((chat) => chat.lastActiveAt >= today - DAY && chat.lastActiveAt < today),
      },
      { label: 'earlier', items: completed.filter((chat) => chat.lastActiveAt < today - DAY) },
    ] as CompletedDay[]
  ).filter((day) => day.items.length)
  return {
    waiting,
    running,
    ...recaps,
    summaries,
    unreadSummaries: summaries.filter((s) => s.summary.status === 'unread').length,
    completed,
    days,
    /** What the tab bar badge counts: threads waiting on you plus recaps that need a decision. */
    needsYou: waiting.length + recaps.attention.length,
    empty:
      !waiting.length &&
      !running.length &&
      !recaps.attention.length &&
      !recaps.sinceVisit.length &&
      !summaries.length &&
      !completed.length,
  }
}
export type InboxModel = ReturnType<typeof buildInbox>
