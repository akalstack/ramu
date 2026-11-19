import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

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
  /** A quieter second choice shown before the action. */
  secondaryLabel?: string
  onSecondary?: () => void
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
const publish = () => {
  all = [...host, ...items].sort((a, b) => b.at - a.at)
  for (const listener of listeners) listener()
}
const emit = (next: CenterNotice[]) => {
  items = next
  publish()
}

export const notices = {
  /** Same id replaces the earlier entry, so a chat or an update never piles up. */
  add(notice: Omit<CenterNotice, 'at'>) {
    emit([{ ...notice, at: Date.now() }, ...items.filter((item) => item.id !== notice.id)].slice(0, 50))
  },
  remove(id: string) {
    if (items.some((item) => item.id === id)) emit(items.filter((item) => item.id !== id))
  },
  clear() {
    if (items.length) emit([])
  },
  /** Notices the computer keeps for every device; replaced whole whenever the host says they changed. */
  setHost(next: CenterNotice[]) {
    host = next
    publish()
  },
  list: () => all,
}

/** How far above the window's bottom edge each open status-bar popover reaches, by popover. */
const panelReach = new Map<string, number>()
let reach: number | null = null
const panelListeners = new Set<() => void>()

/**
 * Toasts and the status-bar popovers share the bottom-right corner, so toasts stack above whichever open popover
 * reaches highest. `null` closes that popover's claim.
 */
export function setStatusPanelReach(panel: string, fromBottom: number | null) {
  if (fromBottom === null) panelReach.delete(panel)
  else panelReach.set(panel, Math.ceil(fromBottom))
  const next = panelReach.size ? Math.max(...panelReach.values()) : null
  if (next === reach) return
  reach = next
  for (const listener of panelListeners) listener()
}

/** Pixels above the window's bottom edge that toasts must keep clear, or `null` when no status popover is open. */
export function useStatusPanelReach(): number | null {
  return useSyncExternalStore(
    (listener) => {
      panelListeners.add(listener)
      return () => {
        panelListeners.delete(listener)
      }
    },
    () => reach,
  )
}

/**
 * Reports an open status-bar popover's top edge while it is open. Attach the returned ref to the popup; it re-measures
 * after positioning settles and whenever the window resizes.
 */
export function useStatusPanel(panel: string, open: boolean) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!open || !node) {
      setStatusPanelReach(panel, null)
      return
    }
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      // Positioning lands a frame after mount, so read on the next one.
      frame = requestAnimationFrame(() => {
        const top = node.getBoundingClientRect().top
        setStatusPanelReach(panel, top > 0 ? window.innerHeight - top : null)
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      setStatusPanelReach(panel, null)
    }
  }, [panel, open, node])
  return setNode
}

export function useNotices(): CenterNotice[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, notices.list)
}
