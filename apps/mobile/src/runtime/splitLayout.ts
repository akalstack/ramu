/**
 * A window this wide shows a thread beside the thread list instead of on its own: an iPad in landscape, a 13-inch iPad
 * either way, an Android tablet in landscape. Narrower windows (an iPad in portrait or in a Split View half) keep one
 * screen at a time, where a list beside the thread would squeeze the transcript.
 */
export const SPLIT_MIN_WIDTH = 900
/** A large phone on its side is as wide, but too short for two scrolling panes; a tablet's short side is longer. */
const TABLET_MIN_SIDE = 600

/** The thread list's width beside an open thread: room for a title, its state line and the project it belongs to. */
export const LIST_PANE_WIDTH = 340

export function showsSplit(width: number, height: number): boolean {
  return Number.isFinite(width) && width >= SPLIT_MIN_WIDTH && Math.min(width, height) >= TABLET_MIN_SIDE
}

type PaneThread = { id: string; status: string; lastActiveAt: number; pinnedAt: number | null; doneAt?: number | null }

/**
 * The threads the list beside an open thread shows: pinned ones first, then the rest by latest activity, with archived
 * and done threads left to the full list. The open thread always stays listed, so the list shows what is on the right.
 */
export function paneThreads<T extends PaneThread>(threads: readonly T[], openId: string, limit: number) {
  const listed = threads.filter((thread) => thread.status !== 'archived' && !thread.doneAt)
  const pinned = listed
    .filter((thread) => thread.pinnedAt !== null)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  const recent = listed.filter((thread) => thread.pinnedAt === null).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const shown = recent.slice(0, limit)
  const open = threads.find((thread) => thread.id === openId)
  if (open && !pinned.includes(open) && !shown.includes(open)) shown.push(open)
  return { pinned, recent: shown, more: recent.length > limit }
}

/** The list a thread was opened from, which a wide window shows beside it. */
export type ThreadOrigin = 'threads' | 'inbox'

/** A thread's route, remembering a list other than the thread list so the thread opens beside it. */
export function threadRoute(id: string, origin: ThreadOrigin) {
  return { pathname: '/chat/[id]' as const, params: origin === 'threads' ? { id } : { id, from: origin } }
}
