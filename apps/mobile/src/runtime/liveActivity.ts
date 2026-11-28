import type { LiveActivityThreadStatus } from '@ramu/shared/api'
import { liveActivityOngoing } from '@ramu/shared/liveActivity'
import { isLimitHold } from '@ramu/shared/chat/goalHold'
import type { Chat } from './types'

type LiveChat = Pick<Chat, 'id' | 'sessionId' | 'title' | 'status' | 'items' | 'goal' | 'lastActiveAt'> &
  Partial<Pick<Chat, 'waitingUntil' | 'inputSummary'>>

/** Where one thread stands, as the Live Activity names it; null for one that is archived. */
export function liveThreadStatus(chat: LiveChat): LiveActivityThreadStatus | null {
  if (chat.status === 'archived') return null
  if (chat.status === 'failed') return 'failed'
  const limited = !!chat.waitingUntil || isLimitHold(chat.goal)
  if (chat.status === 'running') return limited ? 'limit' : 'working'
  if (chat.status !== 'needs-input') return 'done'
  const open = chat.items.filter(
    (item) =>
      (item.kind === 'permission' && item.decision === undefined) ||
      (item.kind === 'question' && item.answers === undefined) ||
      (item.kind === 'elicitation' && item.outcome === undefined) ||
      (item.kind === 'secret' && item.outcome === undefined),
  )
  // The transcript a phone holds may be only the last turns, so the host's summary of open requests also counts.
  if (open.some((item) => item.kind === 'permission') || (chat.inputSummary?.approvals ?? 0) > 0) return 'approval'
  if (open.length || (chat.inputSummary?.count ?? 0) > 0) return 'question'
  return limited ? 'limit' : 'input'
}

/**
 * The threads of the current stretch of work: those it already followed and any that work or wait now. A thread
 * that finished before the stretch began is not part of it, so the activity never reports old work as done.
 */
export function liveActivityThreads(chats: readonly LiveChat[], followed: ReadonlySet<string>) {
  return chats
    .flatMap((chat) => {
      const status = liveThreadStatus(chat)
      return status && (followed.has(chat.id) || liveActivityOngoing(status))
        ? [{ id: chat.id, sessionId: chat.sessionId, title: chat.title, status, at: chat.lastActiveAt }]
        : []
    })
    .sort((a, b) => b.at - a.at)
}

/** What becomes of the activity once a host's work changes; the monitor carries it out. */
type LiveActivityStep = 'start' | 'update' | 'finish' | 'dismiss' | 'none'

/**
 * Decides the activity's next step. Work that needs the person keeps it alive; when nothing runs or waits it shows the
 * finished state, or goes away at once when there is nothing of this stretch to report (one left from an earlier run
 * of Ramu) or the person is already looking at the thread that finished.
 */
export function liveActivityStep(input: {
  active: boolean
  ongoing: number
  followed: number
  online: boolean
  foreground: boolean
  viewingFinished: boolean
}): LiveActivityStep {
  if (!input.online) return 'none'
  if (!input.ongoing) {
    if (!input.active) return 'none'
    return !input.followed || input.viewingFinished ? 'dismiss' : 'finish'
  }
  if (!input.active) return input.foreground ? 'start' : 'none'
  return 'update'
}

/**
 * Which of the activities on screen to keep. A host can start one by push while Ramu is open (an older host, or before
 * this phone's own activity reached it): the app takes it over when it has none, unless the person dismissed this
 * host's, and ends every other beside the one kept and the one finishing.
 */
export function keepOneActivity(input: {
  live: string[]
  current: string | null
  finishing: string | null
  dismissed: boolean
}): { adopt: string | null; end: string[] } {
  const live = input.live.filter((id) => id !== input.finishing)
  const adopt = !input.current && !input.dismissed ? (live[0] ?? null) : null
  const kept = input.current ?? adopt
  return { adopt, end: live.filter((id) => id !== kept) }
}
