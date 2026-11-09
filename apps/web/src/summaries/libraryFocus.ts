import type { LibrarySummaryItem } from '@ramu/shared/types'

type Focus = Pick<LibrarySummaryItem, 'kind' | 'id' | 'title'>
let pending: Focus | null = null

/** Opens the Settings page that holds one item: Agent setup's Skills, or Memory & learning. Settings may still be mounting, so the request waits to be taken. */
export function focusLibraryItem(item: Focus): void {
  pending = item
  window.dispatchEvent(
    new CustomEvent('ramu:settings', { detail: { section: item.kind === 'skill' ? 'agent-setup' : 'memory' } }),
  )
  window.dispatchEvent(new Event('ramu:library-focus'))
}
/** Whether a request for this kind of item waits, so its page can open on the right tab before taking it. */
export const libraryFocusWaiting = (kind: Focus['kind']) => pending?.kind === kind

/** The waiting request for this kind of item, if any. Taking it clears it. */
export function takeLibraryFocus(kind: Focus['kind']): Focus | null {
  if (pending?.kind !== kind) return null
  const taken = pending
  pending = null
  return taken
}
