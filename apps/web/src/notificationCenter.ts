import { useSyncExternalStore, type ReactNode } from 'react'

/** A notification that has popped up. It stays here, in the background-activity popover, until it is opened or dismissed. */
export interface CenterNotice {
  id: string
  title: string
  description?: string
  type: 'info' | 'success' | 'error'
  icon?: ReactNode
  at: number
  actionLabel?: string
  onAction?: () => void
  /** What the ✕ does when removing it here is not enough (a host notice is dismissed for every device). */
  onDismiss?: () => void
  /** Set for chat notices, so they clear themselves once the chat is on screen. */
  taskId?: string
  sessionId?: string
}

/** How long a toast stays on screen before it moves to the popover: long enough to read; errors and updates a little longer. */
export const TOAST_MS = { info: 6000, success: 5000, input: 9000, error: 10000, update: 12000 } as const

let items: CenterNotice[] = []
let host: CenterNotice[] = []
let all: CenterNotice[] = []
const listeners = new Set<() => void>()
const publish = () => { all = [...host, ...items].sort((a, b) => b.at - a.at); for (const listener of listeners) listener() }
const emit = (next: CenterNotice[]) => { items = next; publish() }

export const notices = {
  /** Same id replaces the earlier entry, so a chat or an update never piles up. */
  add(notice: Omit<CenterNotice, 'at'>) { emit([{ ...notice, at: Date.now() }, ...items.filter((item) => item.id !== notice.id)].slice(0, 50)) },
  remove(id: string) { if (items.some((item) => item.id === id)) emit(items.filter((item) => item.id !== id)) },
  clear() { if (items.length) emit([]) },
  /** Notices the computer keeps for every device; replaced whole whenever the host says they changed. */
  setHost(next: CenterNotice[]) { host = next; publish() },
  list: () => all,
}

export function useNotices(): CenterNotice[] {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, notices.list)
}
