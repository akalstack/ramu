import { useSyncExternalStore } from 'react'

/** Drag payload for an editor tab being reordered or docked: the view id. */
export const TAB_DRAG_TYPE = 'application/x-ramu-tab'
/** Drag payload for a terminal group tab being docked: the group id. */
export const TERMINAL_DRAG_TYPE = 'application/x-ramu-terminal'

export type ActiveDrag = 'tab' | 'terminal' | null

// Drag overlays must exist before the first dragover, so tab sources announce what is in flight.
let current: ActiveDrag = null
const listeners = new Set<() => void>()
export function setActiveDrag(next: ActiveDrag) {
  if (current === next) return
  current = next
  listeners.forEach((listener) => listener())
}
/** Announces a drag one tick later: changing the DOM inside `dragstart` can cancel the drag. */
export const beginDrag = (kind: Exclude<ActiveDrag, null>) => { setTimeout(() => setActiveDrag(kind)) }
export const useActiveDrag = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current)

// Bubble phase on purpose: drop targets handle the event first, then the overlay goes away.
if (typeof window !== 'undefined') {
  window.addEventListener('dragend', () => setActiveDrag(null))
  window.addEventListener('drop', () => setActiveDrag(null))
}

/** Shows `row` as the drag preview with the pointer where it grabbed the handle, so the preview stays under the cursor. */
export function setRowDragImage(event: { clientX: number; clientY: number; dataTransfer: DataTransfer }, row: Element | null) {
  if (!row) return
  const box = row.getBoundingClientRect()
  event.dataTransfer.setDragImage(row, Math.max(0, event.clientX - box.left), Math.max(0, event.clientY - box.top))
}
