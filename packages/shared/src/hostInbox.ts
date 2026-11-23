import type { ChatGoal, LibrarySummary, RecapItem, TaskPullRequest, TaskStatus, ThreadInputSummary } from './types'
import { stageNeedsYou } from '@ramu/shared/pullRequests'
import { goalContinues } from '@ramu/shared/chat/goalHold'
import type { LowMemory } from './resources'

// Shared desktop/mobile inbox: what needs you, what is running, recaps, learning, and finished work.
// Keep derivation independent of rendering and apply host scope before limits or counts.

export type InboxTab = 'brief' | 'running' | 'recaps' | 'learned' | 'completed'
export const INBOX_TABS: InboxTab[] = ['brief', 'running', 'recaps', 'learned', 'completed']

/** A saved or linked tab, or the Brief when it is unknown, as the retired All and Waiting tabs now are. */
export const inboxTabOf = (value: unknown): InboxTab =>
  INBOX_TABS.includes(value as InboxTab) ? (value as InboxTab) : 'brief'

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
  /** The thread's pull request; its stage can need the person (replies to send, ready to merge). */
  pullRequest?: TaskPullRequest | null
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
  /** The connector a sign-in is for, when the host reported it. */
  connector?: string
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
    if (input.connectors) {
      const connector = input.requests.find((request) => request.kind === 'connector' && request.connector)?.connector
      return { kind: 'connector', count: input.connectors, ...(connector ? { connector } : {}) }
    }
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

const BLOCKER_ORDER: InboxBlockerKind[] = [
  'approval',
  'connector',
  'question',
  'verification-failed',
  'goal-blocked',
  'turn-limit',
  'goal-paused',
]

/**
 * How many waiting threads need each kind of action, in the order a person would act on them. A long Waiting list
 * with the same ask repeated reads as one line (“3 need approval, 2 need sign-in”) instead of the person counting rows.
 * Threads with no blocker are not counted; a thread counts once, under its first blocker.
 */
export function blockerTally(chats: InboxChat[]): { kind: InboxBlockerKind; threads: number; connector?: string }[] {
  // Sign-ins are counted per connector, so five threads waiting on the same one read as one ask rather than five.
  const counts = new Map<string, { kind: InboxBlockerKind; threads: number; connector?: string }>()
  for (const chat of chats) {
    const blocker = inboxBlocker(chat)
    if (!blocker) continue
    const connector = blocker.kind === 'connector' ? blocker.connector : undefined
    const key = `${blocker.kind}\0${connector ?? ''}`
    const entry = counts.get(key) ?? { kind: blocker.kind, threads: 0, ...(connector ? { connector } : {}) }
    entry.threads++
    counts.set(key, entry)
  }
  return [...counts.values()].sort(
    (a, b) => BLOCKER_ORDER.indexOf(a.kind) - BLOCKER_ORDER.indexOf(b.kind) || b.threads - a.threads,
  )
}

const TALLY_PHRASES: Record<InboxBlockerKind, string> = {
  approval: '{0} need approval',
  connector: '{0} need sign-in',
  question: '{0} have a question',
  'verification-failed': '{0} failed a goal check',
  'goal-blocked': '{0} are blocked',
  'turn-limit': '{0} reached the turn limit',
  'goal-paused': '{0} are paused',
}

/** The tally as one line, each phrase translated by the caller's own `translate` (they register the same sources). */
export const blockerTallyLine = (
  tally: ReturnType<typeof blockerTally>,
  translate: (source: string, values: Record<string, string | number>) => string,
) =>
  tally
    .map((entry) =>
      entry.connector
        ? translate('{0} need sign-in to {1}', { '0': entry.threads, '1': entry.connector })
        : translate(TALLY_PHRASES[entry.kind], { '0': entry.threads }),
    )
    .join(' · ')

/** Threads needed before a summary line is worth showing; two rows can simply be read. */
export const TALLY_MIN_THREADS = 3

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
  // A thread's newest recap tells its story so far; its earlier ones are history it has moved past, so each thread
  // keeps one recent row instead of filling Recaps with every step.
  const seen = new Set<string>()
  const recent = live.filter((r) => {
    if (r.item.group !== 'recent') return false
    const thread = `${r.computerId}:${r.item.taskId}`
    if (seen.has(thread)) return false
    seen.add(thread)
    return true
  })
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
  /** A failure the person already opened on this device no longer asks for them. */
  failureSeen?: (chat: InboxChat) => boolean
  lowMemory?: InboxLowMemory[]
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
  const failureSeen = input.failureSeen ?? (() => false)
  const failed = live
    .filter((chat) => chat.status === 'failed' && !needsInput(chat) && !helpersRunning(chat) && !failureSeen(chat))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  // A pull request whose next step is the person's, on a thread that is not already asking for something else.
  const pullRequests = live
    .filter((chat) => !!chat.pullRequest && stageNeedsYou(chat.pullRequest.stage) && !needsInput(chat))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const lowMemory = (input.lowMemory ?? []).filter((entry) => inScope(entry.computerId))
  const enabled = input.recapsEnabled ?? (() => true)
  // A thread still working, or already asking for something, is followed live: its recap waits until it settles,
  // so one busy thread does not fill the Brief with decisions the work is still overtaking.
  const busy = new Set([...waiting, ...running].map((chat) => `${chat.computerId}:${chat.taskId}`))
  const recaps = splitRecaps(
    input.recaps.filter(
      (r) => inScope(r.computerId) && enabled(r.computerId) && !busy.has(`${r.computerId}:${r.item.taskId}`),
    ),
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
    failed,
    pullRequests,
    lowMemory,
    running,
    ...recaps,
    summaries,
    unreadSummaries: summaries.filter((s) => s.summary.status === 'unread').length,
    completed,
    days,
    /**
     * What the badge counts: each thread that needs you once, whatever the reasons (waiting, a failure not yet looked
     * at, a pull request, recaps that need a decision), and each low host.
     */
    needsYou:
      new Set(
        [...waiting, ...failed, ...pullRequests]
          .map((chat) => `${chat.computerId}:${chat.taskId}`)
          .concat(recaps.attention.map((r) => `${r.computerId}:${r.item.taskId}`)),
      ).size + lowMemory.length,
    empty:
      !waiting.length &&
      !failed.length &&
      !pullRequests.length &&
      !lowMemory.length &&
      !running.length &&
      !recaps.attention.length &&
      !recaps.sinceVisit.length &&
      !summaries.length &&
      !completed.length,
  }
}
export type InboxModel = ReturnType<typeof buildInbox>

export interface InboxLowMemory {
  computerId: string
  low: LowMemory
}

/** `more` counts the thread's other reasons, shown behind its most urgent one. */
export type BriefRow = (
  | { kind: 'failure'; chat: InboxChat }
  | { kind: 'pull-request'; chat: InboxChat }
  | { kind: 'blocker'; chat: InboxChat; blocker: InboxBlocker }
  | { kind: 'low-memory'; memory: InboxLowMemory }
  | { kind: 'recap'; recap: InboxRecap }
) & { more?: number }

/** The thread a Brief row is about, so one thread takes one row. */
const briefThread = (row: BriefRow): string | null =>
  row.kind === 'low-memory'
    ? null
    : row.kind === 'recap'
      ? `${row.recap.computerId}:${row.recap.item.taskId}`
      : `${row.chat.computerId}:${row.chat.taskId}`

/** Rows the Brief shows before **See all**, so the first screen always holds what matters most. */
export const BRIEF_ROWS = 5

const blockerRank = (kind: InboxBlockerKind) =>
  kind === 'approval' || kind === 'connector' || kind === 'question' ? 0 : 2
const briefRank = (row: BriefRow) =>
  row.kind === 'blocker'
    ? blockerRank(row.blocker.kind)
    : row.kind === 'failure' || row.kind === 'pull-request'
      ? 1
      : row.kind === 'low-memory'
        ? 3
        : 4

/** What needs the person now: requests, then failures and pull requests, then limits and paused goals, then recaps needing a decision. */
export function briefRows(
  model: Pick<InboxModel, 'waiting' | 'failed' | 'pullRequests' | 'attention' | 'lowMemory'>,
): BriefRow[] {
  const rows: BriefRow[] = [
    ...model.waiting.flatMap((chat): BriefRow[] => {
      const blocker = inboxBlocker(chat)
      return blocker ? [{ kind: 'blocker', chat, blocker }] : []
    }),
    ...model.failed.map((chat): BriefRow => ({ kind: 'failure', chat })),
    ...model.pullRequests.map((chat): BriefRow => ({ kind: 'pull-request', chat })),
    ...model.lowMemory.map((memory): BriefRow => ({ kind: 'low-memory', memory })),
    ...model.attention.map((recap): BriefRow => ({ kind: 'recap', recap })),
  ]
  // Array sorting is stable, so each kind keeps its newest-first order. Each thread then keeps only its most urgent
  // row, which counts the rest, so a thread with an approval, a failure and recaps reads as one thing to do.
  const shown = new Map<string, BriefRow>()
  return rows
    .sort((a, b) => briefRank(a) - briefRank(b))
    .flatMap((row) => {
      const thread = briefThread(row)
      if (thread === null) return [row]
      const first = shown.get(thread)
      if (first) {
        first.more = (first.more ?? 0) + 1
        return []
      }
      const own = { ...row }
      shown.set(thread, own)
      return [own]
    })
}

/** How serious a Brief row is, and which mark it carries, so desktop and phone draw the same row the same way. */
export type BriefTone = 'bad' | 'warn' | 'neutral'
export type BriefMark =
  'failed' | 'conflicts' | 'pull-request' | 'approval' | 'question' | 'connector' | 'goal' | 'memory' | 'recap'

export function briefRowLook(row: BriefRow): { mark: BriefMark; tone: BriefTone } {
  switch (row.kind) {
    case 'failure':
      return { mark: 'failed', tone: 'bad' }
    case 'pull-request':
      return row.chat.pullRequest?.stage === 'conflicts'
        ? { mark: 'conflicts', tone: 'bad' }
        : { mark: 'pull-request', tone: 'warn' }
    case 'low-memory':
      return { mark: 'memory', tone: 'warn' }
    case 'recap':
      return { mark: 'recap', tone: 'neutral' }
    case 'blocker':
      switch (row.blocker.kind) {
        case 'approval':
        case 'question':
        case 'connector':
          return { mark: row.blocker.kind, tone: 'warn' }
        case 'verification-failed':
          return { mark: 'goal', tone: 'bad' }
        default:
          return { mark: 'goal', tone: 'warn' }
      }
  }
}

export const briefRowHost = (row: BriefRow) =>
  row.kind === 'recap' ? row.recap.computerId : row.kind === 'low-memory' ? row.memory.computerId : row.chat.computerId

/** Threads finished since the last visit, for Home's and the Brief's one summary line. */
export const finishedSince = (model: Pick<InboxModel, 'completed'>, visit: number) =>
  model.completed.filter((chat) => chat.lastActiveAt > visit).length
